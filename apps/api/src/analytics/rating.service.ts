import { Injectable, Logger } from '@nestjs/common';
import type { RatingHistoryPoint, RatingSummary } from '@badminton/contracts';
import {
  DEFAULT_RATING_CONFIG,
  ratingDeviation,
  replayRatings,
  summariseRating,
} from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { MatchRecordLoader } from '../matches/match-record.loader';

/**
 * Maintains the estimated rating.
 *
 * Ratings are *replayed from scratch* over the user's whole match history rather than
 * updated incrementally. That costs more per write, but it is the only approach where
 * editing a match from six months ago yields a correct rating today, and where the
 * rating model can be re-tuned without a migration. For the volumes a personal tracker
 * produces — thousands of matches, not millions — a full replay is a few milliseconds.
 *
 * The stored `RatingEvent` rows and `Player.rating` values are therefore a cache, and
 * `recalculate` is the invalidation mechanism.
 */
@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MatchRecordLoader,
  ) {}

  async recalculate(userId: string): Promise<{ matchesRated: number }> {
    const matches = await this.loader.loadWhere({ userId });
    const replay = replayRatings(matches, DEFAULT_RATING_CONFIG);

    await this.prisma.$transaction(async (tx) => {
      await tx.ratingEvent.deleteMany({ where: { userId } });

      if (replay.events.length > 0) {
        await tx.ratingEvent.createMany({
          data: replay.events.map((event) => ({
            userId,
            matchId: event.matchId,
            discipline: event.discipline,
            playedAt: event.playedAt,
            ratingBefore: event.ratingBefore,
            ratingAfter: event.ratingAfter,
            delta: event.delta,
            opponentRating: event.opponentRating,
            kFactor: event.kFactor,
            result: event.result,
          })),
        });
      }

      // Opponent and partner ratings, so the address book can show them.
      for (const [playerId, state] of replay.playerRatings) {
        await tx.player.updateMany({
          where: { id: playerId, userId },
          data: { rating: state.rating, ratingDeviation: ratingDeviation(state.matches) },
        });
      }

      await tx.player.updateMany({
        where: { userId, isSelf: true },
        data: {
          rating: replay.userRating.rating,
          ratingDeviation: ratingDeviation(replay.userRating.matches),
        },
      });
    });

    return { matchesRated: replay.events.length };
  }

  async summary(userId: string): Promise<RatingSummary> {
    const matches = await this.loader.loadWhere({ userId });
    return summariseRating(replayRatings(matches, DEFAULT_RATING_CONFIG), DEFAULT_RATING_CONFIG);
  }

  async history(userId: string, limit = 200): Promise<RatingHistoryPoint[]> {
    const events = await this.prisma.ratingEvent.findMany({
      where: { userId },
      orderBy: { playedAt: 'asc' },
      take: limit,
    });

    return events.map((event) => ({
      matchId: event.matchId,
      playedAt: event.playedAt.toISOString(),
      discipline: event.discipline,
      ratingBefore: event.ratingBefore,
      ratingAfter: event.ratingAfter,
      delta: event.delta,
      opponentRating: event.opponentRating,
      result: event.result,
    }));
  }
}
