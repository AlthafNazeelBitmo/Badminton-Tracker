import { Injectable } from '@nestjs/common';
import { ACHIEVEMENTS, type AchievementCounters, type AchievementView } from '@badminton/contracts';
import { achievementCounters } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { MatchRecordLoader } from '../matches/match-record.loader';

/**
 * Automatic achievement detection.
 *
 * The badge catalogue is declarative data in `@badminton/contracts`, so detection is one
 * generic pass over a counter object rather than a growing pile of bespoke conditions.
 * Adding a badge is a one-line change and needs no migration, because only the *unlock*
 * is persisted — the definition lives in code.
 *
 * Unlocks are written with `skipDuplicates`, making evaluation idempotent: running it
 * twice cannot double-award, and a missed run is repaired by the next one.
 */
@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MatchRecordLoader,
  ) {}

  async counters(userId: string): Promise<AchievementCounters> {
    const matches = await this.loader.loadWhere({ userId });
    return achievementCounters(matches);
  }

  /** Awards any newly earned badges and returns them. */
  async evaluate(userId: string): Promise<AchievementView[]> {
    const counters = await this.counters(userId);

    const existing = await this.prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementCode: true },
    });
    const unlocked = new Set(existing.map((row) => row.achievementCode));

    const newlyEarned = ACHIEVEMENTS.filter(
      (achievement) =>
        !unlocked.has(achievement.code) && counters[achievement.counter] >= achievement.threshold,
    );

    if (newlyEarned.length > 0) {
      await this.prisma.userAchievement.createMany({
        data: newlyEarned.map((achievement) => ({
          userId,
          achievementCode: achievement.code,
          valueAtUnlock: Math.round(counters[achievement.counter]),
        })),
        skipDuplicates: true,
      });

      await this.prisma.notification.createMany({
        data: newlyEarned.map((achievement) => ({
          userId,
          type: 'ACHIEVEMENT' as const,
          title: `Achievement unlocked: ${achievement.name}`,
          body: achievement.description,
          dedupeKey: `achievement:${achievement.code}`,
        })),
        skipDuplicates: true,
      });
    }

    const now = new Date().toISOString();
    return newlyEarned.map((achievement) => ({
      ...achievement,
      unlocked: true,
      unlockedAt: now,
      progress: counters[achievement.counter],
      percentComplete: 100,
    }));
  }

  /** The full catalogue with progress, for the achievements page. */
  async list(userId: string): Promise<AchievementView[]> {
    const [counters, rows] = await Promise.all([
      this.counters(userId),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);

    const unlockedAt = new Map(rows.map((row) => [row.achievementCode, row.unlockedAt]));

    return ACHIEVEMENTS.map((achievement) => {
      const progress = counters[achievement.counter];
      const unlockDate = unlockedAt.get(achievement.code);
      return {
        ...achievement,
        unlocked: Boolean(unlockDate),
        unlockedAt: unlockDate ? unlockDate.toISOString() : null,
        progress,
        percentComplete: Math.min(
          100,
          Math.round((progress / achievement.threshold) * 100 * 10) / 10,
        ),
      };
    }).sort((a, b) => {
      // Unlocked first, then closest to unlocking, so the page opens on what matters.
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return b.percentComplete - a.percentComplete;
    });
  }
}
