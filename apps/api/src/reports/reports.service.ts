import { Injectable } from '@nestjs/common';
import type { AnalyticsFilter, PerformanceReport } from '@badminton/contracts';
import { ANALYTICS_CONSTANTS } from '@badminton/analytics';
import { AnalyticsService } from '../analytics/analytics.service';
import { RatingService } from '../analytics/rating.service';
import { MatchRecordLoader } from '../matches/match-record.loader';

/**
 * Assembles a shareable performance report.
 *
 * Everything here is composed from the analytics endpoints rather than recomputed, so
 * the report can never disagree with the dashboard it summarises. "Best" opponent,
 * partner and venue require a minimum sample so a single lucky match cannot become a
 * headline.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly ratings: RatingService,
    private readonly loader: MatchRecordLoader,
  ) {}

  async performance(userId: string, filter: AnalyticsFilter): Promise<PerformanceReport> {
    const [overview, disciplines, trend, records, insights, opponents, partners, venues, rating] =
      await Promise.all([
        this.analytics.overview(userId, filter),
        this.analytics.disciplines(userId, filter),
        this.analytics.trend(userId, filter, 'MONTH'),
        this.analytics.records(userId, filter),
        this.analytics.insights(userId, filter),
        this.analytics.opponents(userId, filter),
        this.analytics.partners(userId, filter),
        this.analytics.venues(userId, filter),
        this.ratings.summary(userId),
      ]);

    const min = ANALYTICS_CONSTANTS.minMatchesForInsight;
    const range = this.loader.resolveRange(filter);

    const eligibleOpponents = opponents.filter((entry) => entry.stats.matches >= min);
    const eligiblePartners = partners.filter((entry) => entry.stats.matches >= min);
    const eligibleVenues = venues.filter(
      (entry) => entry.stats.matches >= min && entry.subject.id !== null,
    );

    const bestOpponent = highestWinRate(eligibleOpponents);
    const toughestOpponent = lowestWinRate(eligibleOpponents);
    const bestPartner = highestWinRate(eligiblePartners);
    const bestVenue = highestWinRate(eligibleVenues);

    return {
      generatedAt: new Date().toISOString(),
      period: {
        from: range.from ? range.from.toISOString() : overview.firstMatchAt,
        to: range.to ? range.to.toISOString() : overview.lastMatchAt,
        label: describePeriod(filter),
      },
      stats: overview.stats,
      streaks: overview.streaks,
      rating,
      bestOpponent: bestOpponent
        ? {
            name: bestOpponent.subject.name,
            winRate: bestOpponent.stats.winRate,
            matches: bestOpponent.stats.matches,
          }
        : null,
      toughestOpponent: toughestOpponent
        ? {
            name: toughestOpponent.subject.name,
            winRate: toughestOpponent.stats.winRate,
            matches: toughestOpponent.stats.matches,
          }
        : null,
      bestPartner: bestPartner
        ? {
            name: bestPartner.subject.name,
            winRate: bestPartner.stats.winRate,
            matches: bestPartner.stats.matches,
          }
        : null,
      bestVenue: bestVenue
        ? {
            name: bestVenue.subject.name,
            winRate: bestVenue.stats.winRate,
            matches: bestVenue.stats.matches,
          }
        : null,
      disciplines,
      monthlyTrend: trend.points,
      records,
      insights,
    };
  }
}

interface Ranked {
  subject: { name: string };
  stats: { winRate: number | null; matches: number };
}

function highestWinRate<T extends Ranked>(entries: T[]): T | null {
  const rated = entries.filter((entry) => entry.stats.winRate !== null);
  if (rated.length === 0) return null;
  return rated.reduce((best, entry) =>
    (entry.stats.winRate ?? 0) > (best.stats.winRate ?? 0) ? entry : best,
  );
}

function lowestWinRate<T extends Ranked>(entries: T[]): T | null {
  const rated = entries.filter((entry) => entry.stats.winRate !== null);
  if (rated.length === 0) return null;
  return rated.reduce((worst, entry) =>
    (entry.stats.winRate ?? 100) < (worst.stats.winRate ?? 100) ? entry : worst,
  );
}

function describePeriod(filter: AnalyticsFilter): string {
  const labels: Record<string, string> = {
    TODAY: 'Today',
    THIS_WEEK: 'This week',
    THIS_MONTH: 'This month',
    LAST_30_DAYS: 'Last 30 days',
    LAST_90_DAYS: 'Last 3 months',
    LAST_180_DAYS: 'Last 6 months',
    THIS_YEAR: 'This year',
    LAST_YEAR: 'Last year',
    ALL_TIME: 'All time',
  };

  if (filter.preset === 'CUSTOM' && filter.from && filter.to) {
    return `${filter.from.toISOString().slice(0, 10)} to ${filter.to.toISOString().slice(0, 10)}`;
  }
  return labels[filter.preset] ?? 'All time';
}
