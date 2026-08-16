import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { computeStreaks, daysBetween } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { MatchRecordLoader } from '../matches/match-record.loader';
import { GoalsService } from './goals.service';

interface Candidate {
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
}

/** Milestones worth telling someone about. Anything else is noise. */
const MATCH_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const INACTIVITY_DAYS = 14;

/**
 * Generates notifications on demand.
 *
 * Two rules keep this from becoming spam:
 *  - Every notification carries a `dedupeKey` with a unique constraint behind it, so
 *    the same event can never be announced twice however often generation runs.
 *  - Nothing fires speculatively. A streak notification needs the streak to exist now;
 *    a milestone notification needs the milestone to be within reach now.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MatchRecordLoader,
    private readonly goals: GoalsService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount: rows.filter((row) => row.readAt === null).length,
    };
  }

  async generate(userId: string): Promise<{ created: number }> {
    const matches = await this.loader.loadWhere({ userId });
    const candidates: Candidate[] = [];

    const streaks = computeStreaks(matches);
    if (streaks.currentWinStreak >= 5) {
      candidates.push({
        type: 'STREAK',
        title: `${streaks.currentWinStreak}-match winning streak`,
        body: `You have won your last ${streaks.currentWinStreak} matches.`,
        // Keyed by length, so each new rung of the streak announces itself once.
        dedupeKey: `streak:win:${streaks.currentWinStreak}`,
      });
    }

    const total = matches.length;
    const nextMilestone = MATCH_MILESTONES.find((milestone) => milestone > total);
    if (nextMilestone && nextMilestone - total <= 3 && total > 0) {
      candidates.push({
        type: 'MILESTONE',
        title: `${nextMilestone - total} matches from ${nextMilestone}`,
        body: `You have recorded ${total} matches. ${nextMilestone} is within reach.`,
        dedupeKey: `milestone:approach:${nextMilestone}`,
      });
    }
    const reached = MATCH_MILESTONES.filter((milestone) => total >= milestone).pop();
    if (reached) {
      candidates.push({
        type: 'MILESTONE',
        title: `${reached} matches recorded`,
        body: `You have now recorded ${reached} matches.`,
        dedupeKey: `milestone:reached:${reached}`,
      });
    }

    const ordered = [...matches].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
    const lastMatch = ordered[ordered.length - 1];
    if (lastMatch) {
      const idle = daysBetween(lastMatch.playedAt, new Date());
      if (idle >= INACTIVITY_DAYS) {
        // Bucketed by fortnight so a long break produces a handful of nudges, not one a day.
        const bucket = Math.floor(idle / INACTIVITY_DAYS);
        candidates.push({
          type: 'INACTIVITY',
          title: `${idle} days since your last match`,
          body: 'Recording a session keeps your trends meaningful.',
          dedupeKey: `inactivity:${lastMatch.playedAt.toISOString().slice(0, 10)}:${bucket}`,
        });
      }
    }

    const goals = await this.goals.list(userId, { page: 1, pageSize: 100, status: 'ACTIVE' });
    for (const goal of goals.items) {
      if (goal.daysRemaining !== null && goal.daysRemaining >= 0 && goal.daysRemaining <= 7) {
        candidates.push({
          type: 'GOAL_DEADLINE',
          title: `"${goal.title}" is due in ${goal.daysRemaining} day${goal.daysRemaining === 1 ? '' : 's'}`,
          body: `You are ${goal.percentComplete}% of the way there.`,
          dedupeKey: `goal:deadline:${goal.id}:${goal.deadline}`,
        });
      }
    }

    if (candidates.length === 0) return { created: 0 };

    const result = await this.prisma.notification.createMany({
      data: candidates.map((candidate) => ({ userId, ...candidate })),
      skipDuplicates: true,
    });

    return { created: result.count };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundError('Notification');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
