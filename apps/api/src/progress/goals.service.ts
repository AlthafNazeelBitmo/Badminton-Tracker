import { Injectable } from '@nestjs/common';
import type { Prisma, Goal } from '@prisma/client';
import type {
  CreateGoalInput,
  GoalMetric,
  GoalProgress,
  ListGoalsQuery,
  Paginated,
  UpdateGoalInput,
} from '@badminton/contracts';
import { aggregate, computeStreaks, type MatchRecord } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { pageMeta, paginate } from '../common/pagination';
import { MatchRecordLoader } from '../matches/match-record.loader';

/**
 * Goals.
 *
 * Progress is *never stored*. It is computed from matches on every read, so a goal
 * cannot drift out of step with reality when a match is edited or deleted. The only
 * persisted state is the goal's definition and the moment it was first achieved —
 * because "when did I hit 100 matches" is a fact about history, not a derived number.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MatchRecordLoader,
  ) {}

  async list(userId: string, query: ListGoalsQuery): Promise<Paginated<GoalProgress>> {
    const where: Prisma.GoalWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const { skip, take } = paginate(query);

    const [goals, totalItems] = await this.prisma.$transaction([
      this.prisma.goal.findMany({
        where,
        orderBy: [{ status: 'asc' }, { deadline: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.goal.count({ where }),
    ]);

    const items = await this.withProgress(userId, goals);
    return { items, meta: pageMeta(query, totalItems) };
  }

  async findOne(userId: string, id: string): Promise<GoalProgress> {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundError('Goal');
    const [progress] = await this.withProgress(userId, [goal]);
    if (!progress) throw new NotFoundError('Goal');
    return progress;
  }

  async create(userId: string, input: CreateGoalInput): Promise<GoalProgress> {
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: input.title,
        metric: input.metric,
        targetValue: input.targetValue,
        discipline: input.discipline ?? null,
        startsOn: startOfUtcDay(input.startsOn ?? new Date()),
        deadline: input.deadline ? startOfUtcDay(input.deadline) : null,
        notes: input.notes ?? null,
      },
    });

    const [progress] = await this.withProgress(userId, [goal]);
    return progress!;
  }

  async update(userId: string, id: string, input: UpdateGoalInput): Promise<GoalProgress> {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundError('Goal');

    await this.prisma.goal.update({
      where: { id },
      data: {
        title: input.title,
        targetValue: input.targetValue,
        deadline:
          input.deadline === undefined
            ? undefined
            : input.deadline
              ? startOfUtcDay(input.deadline)
              : null,
        status: input.status,
        notes: input.notes === undefined ? undefined : input.notes,
      },
    });

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundError('Goal');
    await this.prisma.goal.delete({ where: { id } });
  }

  /**
   * Computes progress for a set of goals with one match load rather than one per goal,
   * and records the first time each goal is met.
   */
  private async withProgress(userId: string, goals: Goal[]): Promise<GoalProgress[]> {
    if (goals.length === 0) return [];

    // The earliest start date across the goals bounds a single query that serves them
    // all; each goal then filters the in-memory slice it needs.
    const earliest = goals.reduce(
      (min, goal) => (goal.startsOn < min ? goal.startsOn : min),
      goals[0]!.startsOn,
    );

    const matches = await this.loader.loadWhere({
      userId,
      playedAt: { gte: earliest },
    });

    const now = new Date();
    const results: GoalProgress[] = [];
    const newlyAchieved: string[] = [];

    for (const goal of goals) {
      const relevant = matches.filter(
        (match) =>
          match.playedAt >= goal.startsOn &&
          (goal.deadline === null || match.playedAt <= endOfUtcDay(goal.deadline)) &&
          (goal.discipline === null || match.discipline === goal.discipline),
      );

      const currentValue = measure(goal.metric, relevant);
      const percentComplete =
        goal.targetValue === 0
          ? 100
          : Math.max(0, Math.min(100, Math.round((currentValue / goal.targetValue) * 1000) / 10));

      const met = currentValue >= goal.targetValue;
      const daysRemaining =
        goal.deadline === null
          ? null
          : Math.ceil((endOfUtcDay(goal.deadline).getTime() - now.getTime()) / 86_400_000);

      let status = goal.status;
      if (goal.status === 'ACTIVE') {
        if (met) {
          status = 'ACHIEVED';
          newlyAchieved.push(goal.id);
        } else if (daysRemaining !== null && daysRemaining < 0) {
          status = 'MISSED';
        }
      }

      const remaining = Math.max(0, goal.targetValue - currentValue);

      results.push({
        id: goal.id,
        title: goal.title,
        metric: goal.metric,
        discipline: goal.discipline,
        targetValue: goal.targetValue,
        currentValue,
        percentComplete,
        status,
        startsOn: goal.startsOn.toISOString().slice(0, 10),
        deadline: goal.deadline ? goal.deadline.toISOString().slice(0, 10) : null,
        daysRemaining,
        requiredDailyPace:
          daysRemaining === null || daysRemaining <= 0 || met
            ? null
            : Math.round((remaining / daysRemaining) * 100) / 100,
        achievedAt: goal.achievedAt
          ? goal.achievedAt.toISOString()
          : met
            ? now.toISOString()
            : null,
        notes: goal.notes,
      });
    }

    // Persist the transition so the achievement date survives later data changes.
    if (newlyAchieved.length > 0) {
      await this.prisma.goal.updateMany({
        where: { id: { in: newlyAchieved }, status: 'ACTIVE' },
        data: { status: 'ACHIEVED', achievedAt: now },
      });
    }

    return results;
  }
}

/**
 * Maps a goal metric onto the analytics engine.
 *
 * Every value comes from `aggregate` or `computeStreaks` — the same functions the
 * dashboard uses — so a goal can never disagree with the number shown elsewhere.
 */
function measure(metric: GoalMetric, matches: readonly MatchRecord[]): number {
  const stats = aggregate(matches);

  switch (metric) {
    case 'MATCHES_PLAYED':
      return stats.matches;
    case 'MATCHES_WON':
      return stats.wins;
    case 'SESSIONS_PLAYED':
      return new Set(matches.map((match) => match.sessionId)).size;
    case 'WIN_RATE':
      return stats.winRate ?? 0;
    case 'GAME_WIN_RATE':
      return stats.gameWinRate ?? 0;
    case 'POINT_DIFFERENTIAL':
      return stats.pointDifferential;
    case 'WIN_STREAK':
      return computeStreaks(matches).bestWinStreak;
    case 'PLAYING_MINUTES':
      return Math.round(stats.playingSeconds / 60);
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}
