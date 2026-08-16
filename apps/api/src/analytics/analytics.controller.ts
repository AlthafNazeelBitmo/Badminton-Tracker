import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  analyticsFilterSchema,
  granularityQuerySchema,
  type AnalyticsFilter,
  type DisciplineBreakdown,
  type FatigueResponse,
  type HeatmapResponse,
  type Insight,
  type OpponentBreakdown,
  type OverviewResponse,
  type PartnerBreakdown,
  type PerformanceStats,
  type PersonalRecord,
  type RatingHistoryPoint,
  type RatingSummary,
  type SearchResult,
  type SituationalResponse,
  type TagCorrelation,
  type TrendResponse,
  type VenueBreakdown,
} from '@badminton/contracts';
import { z } from 'zod';
import { zodQuery } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { RatingService } from './rating.service';

/**
 * Analytics endpoints.
 *
 * Every route takes the same `AnalyticsFilter` query shape, so the dashboard's filter
 * bar drives all of them without per-page special cases.
 */
@ApiTags('analytics')
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly ratings: RatingService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Headline statistics, streaks and period-over-period change' })
  overview(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<OverviewResponse> {
    return this.analytics.overview(userId, filter);
  }

  @Get('trend')
  @ApiOperation({ summary: 'Performance bucketed by day, week, month or year' })
  trend(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
    @Query(zodQuery(granularityQuerySchema)) query: { granularity: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' },
  ): Promise<TrendResponse> {
    return this.analytics.trend(userId, filter, query.granularity);
  }

  @Get('form')
  @ApiOperation({ summary: 'Rolling win rate over recent matches' })
  form(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
    @Query(zodQuery(z.object({ window: z.coerce.number().int().min(3).max(50).default(10) })))
    query: { window: number },
  ): Promise<Array<{ playedAt: string; winRate: number }>> {
    return this.analytics.form(userId, filter, query.window);
  }

  @Get('opponents')
  @ApiOperation({ summary: 'Head-to-head record against every opponent' })
  opponents(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<OpponentBreakdown[]> {
    return this.analytics.opponents(userId, filter);
  }

  @Get('partners')
  @ApiOperation({ summary: 'Record with every doubles partner' })
  partners(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<PartnerBreakdown[]> {
    return this.analytics.partners(userId, filter);
  }

  @Get('venues')
  @ApiOperation({ summary: 'Performance by venue, split by discipline' })
  venues(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<VenueBreakdown[]> {
    return this.analytics.venues(userId, filter);
  }

  @Get('disciplines')
  @ApiOperation({ summary: 'Singles versus doubles versus mixed doubles' })
  disciplines(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<DisciplineBreakdown[]> {
    return this.analytics.disciplines(userId, filter);
  }

  @Get('situational')
  @ApiOperation({ summary: 'Clutch, blowout, decider, comeback and consistency analysis' })
  situational(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<SituationalResponse> {
    return this.analytics.situational(userId, filter);
  }

  @Get('fatigue')
  @ApiOperation({ summary: 'Performance by position within a session' })
  fatigue(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<FatigueResponse> {
    return this.analytics.fatigue(userId, filter);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Win rate associated with each performance tag' })
  tags(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<TagCorrelation[]> {
    return this.analytics.tags(userId, filter);
  }

  @Get('difficulty')
  @ApiOperation({ summary: 'Performance by self-reported match difficulty' })
  difficulty(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<Array<{ difficulty: number; stats: PerformanceStats }>> {
    return this.analytics.difficulty(userId, filter);
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Calendar activity heatmap' })
  heatmap(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<HeatmapResponse> {
    return this.analytics.heatmap(userId, filter);
  }

  @Get('records')
  @ApiOperation({ summary: 'Personal records, recomputed from raw matches' })
  records(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<PersonalRecord[]> {
    return this.analytics.records(userId, filter);
  }

  @Get('insights')
  @ApiOperation({
    summary: 'Data-backed insights',
    description:
      'Each insight carries its evidence and a kind: OBSERVATION (what the data says), ' +
      'INTERPRETATION (a reading of it) or RECOMMENDATION (a suggested focus). Insights ' +
      'below their minimum sample size are withheld rather than reported weakly.',
  })
  insights(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(analyticsFilterSchema)) filter: AnalyticsFilter,
  ): Promise<Insight[]> {
    return this.analytics.insights(userId, filter);
  }

  @Get('rating')
  @ApiOperation({ summary: 'Estimated rating (not an official ranking)' })
  rating(@CurrentUser('id') userId: string): Promise<RatingSummary> {
    return this.ratings.summary(userId);
  }

  @Get('rating/history')
  @ApiOperation({ summary: 'Rating progression over time' })
  ratingHistory(@CurrentUser('id') userId: string): Promise<RatingHistoryPoint[]> {
    return this.ratings.history(userId);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search players, venues, sessions and matches' })
  search(
    @CurrentUser('id') userId: string,
    @Query(zodQuery(z.object({ q: z.string().max(120).default('') }))) query: { q: string },
  ): Promise<SearchResult> {
    return this.analytics.search(userId, query.q);
  }
}
