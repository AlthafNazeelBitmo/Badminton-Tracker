'use client';

import { useState } from 'react';
import { DISCIPLINE_LABELS, PERFORMANCE_TAG_LABELS } from '@badminton/contracts';
import {
  useDisciplines,
  useFatigue,
  useFilterState,
  useRatingHistory,
  useSituational,
  useTagCorrelations,
  useTrend,
} from '@/lib/hooks';
import { EM_DASH, percent, signed } from '@/lib/format';
import {
  ChartFrame,
  ChartTableToggle,
  DifferentialBars,
  Legend,
  RatingTrend,
  SessionPositionBars,
  WinRateTrend,
  WonLostBars,
} from '@/components/charts';
import { FilterBar } from '@/components/filter-bar';
import { Card, CardHeader, ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui';
import { StatsTable } from '@/components/stats-table';

type Granularity = 'WEEK' | 'MONTH' | 'YEAR';

/**
 * Performance analytics.
 *
 * Every chart here answers one question and states the numbers behind it in text as
 * well as in pixels, so nothing depends on reading a colour or estimating a bar. Charts
 * that need a granularity share one control rather than each inventing their own.
 */
export default function AnalyticsPage() {
  const { filter, update, query } = useFilterState({ preset: 'LAST_180_DAYS' });
  const [granularity, setGranularity] = useState<Granularity>('MONTH');
  const [showTrendTable, setShowTrendTable] = useState(false);

  const trend = useTrend(query, granularity);
  const disciplines = useDisciplines(query);
  const situational = useSituational(query);
  const fatigue = useFatigue(query);
  const tags = useTagCorrelations(query);
  const ratings = useRatingHistory();

  if (trend.error) return <ErrorState error={trend.error as Error} onRetry={() => void trend.mutate()} />;

  const points = trend.data?.points ?? [];

  return (
    <>
      <PageHeader
        title="Performance"
        description="How results move over time, and where they come from."
      />

      <FilterBar filter={filter} onChange={update} className="mb-4" />

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs font-medium text-ink-secondary">Group by</span>
        <div role="group" aria-label="Granularity" className="flex gap-1">
          {(['WEEK', 'MONTH', 'YEAR'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={granularity === value}
              onClick={() => setGranularity(value)}
              className={
                granularity === value
                  ? 'rounded-sm border border-accent bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent'
                  : 'rounded-sm border border-line px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong'
              }
            >
              {value === 'WEEK' ? 'Week' : value === 'MONTH' ? 'Month' : 'Year'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {/* Win rate over time */}
        <ChartFrame
          title="Win rate over time"
          description="Periods with no matches are omitted, not drawn as zero."
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {trend.data?.winRateTrendPerPeriod === null ||
                trend.data?.winRateTrendPerPeriod === undefined
                  ? 'Not enough periods to describe a direction.'
                  : `Least-squares trend ${signed(trend.data.winRateTrendPerPeriod, 1)} points per period.`}
              </span>
              <ChartTableToggle
                showTable={showTrendTable}
                onToggle={() => setShowTrendTable((open) => !open)}
              />
            </div>
          }
          height={showTrendTable ? 300 : 260}
        >
          {trend.isLoading && !trend.data ? (
            <Skeleton className="h-full" />
          ) : showTrendTable ? (
            <div className="h-full overflow-auto px-3">
              <StatsTable
                caption="Win rate by period"
                columns={[
                  { key: 'label', header: 'Period' },
                  { key: 'matches', header: 'Matches', align: 'right' },
                  { key: 'record', header: 'W–L', align: 'right' },
                  { key: 'winRate', header: 'Win rate', align: 'right' },
                  { key: 'diff', header: 'Diff', align: 'right' },
                ]}
                rows={points.map((point) => ({
                  key: point.periodStart,
                  label: point.label,
                  matches: point.stats.matches,
                  record: `${point.stats.wins}–${point.stats.losses}`,
                  winRate: percent(point.stats.winRate),
                  diff: signed(point.stats.pointDifferential),
                }))}
              />
            </div>
          ) : (
            <WinRateTrend
              data={points.map((point) => ({
                label: point.label.replace(/ \d{4}$/, ''),
                periodStart: point.periodStart,
                winRate: point.stats.winRate,
                matches: point.stats.matches,
              }))}
              height={260}
            />
          )}
        </ChartFrame>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Point differential */}
          <ChartFrame
            title="Point differential"
            description="Points scored minus points conceded, per period."
            footer="Above the line means you outscored the opposition over the period."
          >
            {trend.isLoading && !trend.data ? (
              <Skeleton className="h-full" />
            ) : (
              <DifferentialBars
                data={points.map((point) => ({
                  label: point.label.replace(/ \d{4}$/, ''),
                  value: point.stats.pointDifferential,
                }))}
              />
            )}
          </ChartFrame>

          {/* Games won and lost */}
          <ChartFrame
            title="Games won and lost"
            legend={
              <Legend
                items={[
                  { label: 'Won', color: 'var(--diverge-positive)' },
                  { label: 'Lost', color: 'var(--diverge-negative)' },
                ]}
              />
            }
            description="Games, not matches — a 2-1 win still costs a game."
          >
            {trend.isLoading && !trend.data ? (
              <Skeleton className="h-full" />
            ) : (
              <WonLostBars
                data={points.map((point) => ({
                  label: point.label.replace(/ \d{4}$/, ''),
                  won: point.stats.gamesWon,
                  lost: point.stats.gamesLost,
                }))}
              />
            )}
          </ChartFrame>
        </div>

        {/* Discipline comparison */}
        <Card>
          <CardHeader
            title="Singles, doubles and mixed"
            description="The same measures for each format, side by side."
          />
          <div className="overflow-x-auto p-4 sm:p-5">
            <StatsTable
              caption="Performance by discipline"
              columns={[
                { key: 'label', header: 'Format' },
                { key: 'matches', header: 'Matches', align: 'right' },
                { key: 'record', header: 'W–L', align: 'right' },
                { key: 'winRate', header: 'Win rate', align: 'right' },
                { key: 'gameRate', header: 'Game rate', align: 'right' },
                { key: 'pointRate', header: 'Point rate', align: 'right' },
                { key: 'diff', header: 'Diff', align: 'right' },
              ]}
              rows={(disciplines.data ?? []).map((entry) => ({
                key: entry.subject.discipline,
                label: DISCIPLINE_LABELS[entry.subject.discipline],
                matches: entry.stats.matches,
                record: `${entry.stats.wins}–${entry.stats.losses}`,
                winRate: percent(entry.stats.winRate),
                gameRate: percent(entry.stats.gameWinRate),
                pointRate: percent(entry.stats.pointWinRate),
                diff: signed(entry.stats.pointDifferential),
              }))}
            />
          </div>
        </Card>

        {/* Situational */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Where matches are decided</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Close matches"
              value={percent(situational.data?.clutch.stats.winRate)}
              detail={`${situational.data?.clutch.stats.matches ?? 0} matches within ${
                situational.data?.clutch.thresholdMargin ?? 3
              } points a game`}
            />
            <Stat
              label="Deciding games"
              value={percent(situational.data?.deciders.winRate)}
              detail={`${situational.data?.deciders.matches ?? 0} went the distance`}
            />
            <Stat
              label="After winning game 1"
              value={percent(situational.data?.afterWinningFirstGame)}
              detail={`${situational.data?.firstGames.won ?? 0} such matches`}
            />
            <Stat
              label="After losing game 1"
              value={percent(situational.data?.afterLosingFirstGame)}
              detail={`${situational.data?.comebacks ?? 0} comebacks, ${
                situational.data?.collapses ?? 0
              } collapses`}
            />
          </div>

          <Card className="card-pad mt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Consistency score
                </p>
                <p className="mt-1 text-stat font-semibold">
                  {situational.data?.consistency.score ?? EM_DASH}
                  {situational.data?.consistency.score !== null &&
                  situational.data?.consistency.score !== undefined ? (
                    <span className="text-base font-normal text-ink-muted"> / 100</span>
                  ) : null}
                </p>
              </div>
              <p className="max-w-md text-xs text-ink-secondary">
                {situational.data?.consistency.score === null
                  ? 'Needs at least five games before it means anything.'
                  : `Standard deviation of ${situational.data?.consistency.standardDeviation} points across ${situational.data?.consistency.sampleSize} games. Higher means more repeatable results, not better ones.`}
              </p>
            </div>
            <p className="mt-2 border-t border-line pt-2 text-xs text-ink-muted">
              Method: {situational.data?.consistency.method ?? 'unavailable'}
            </p>
          </Card>
        </section>

        {/* Fatigue */}
        <Card>
          <CardHeader
            title="Through a session"
            description="Win rate by position within a session."
          />
          <div className="p-4 sm:p-5">
            {fatigue.isLoading && !fatigue.data ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <SessionPositionBars
                  buckets={(fatigue.data?.buckets ?? []).map((bucket) => ({
                    matchNumber: bucket.matchNumber,
                    winRate: bucket.stats.winRate,
                    matches: bucket.stats.matches,
                  }))}
                />
                <p className="mt-3 border-t border-line pt-3 text-sm text-ink-secondary">
                  {fatigue.data?.observation ??
                    'Not enough sessions yet to say anything about how results move through a session.'}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  This describes scorelines, not physiology. Who you play later in a session is
                  part of the picture too.
                </p>
              </>
            )}
          </div>
        </Card>

        {/* Rating */}
        <ChartFrame
          title="Rating progression"
          description="An estimate from matches recorded here — not an official ranking."
          footer="Elo with a provisional K-factor for the first ten matches. See docs/analytics.md for the formula."
        >
          {ratings.isLoading && !ratings.data ? (
            <Skeleton className="h-full" />
          ) : (
            <RatingTrend
              data={(ratings.data ?? []).map((point) => ({
                playedAt: point.playedAt,
                rating: point.ratingAfter,
                result: point.result,
              }))}
            />
          )}
        </ChartFrame>

        {/* Tags */}
        {(tags.data?.length ?? 0) > 0 ? (
          <Card>
            <CardHeader
              title="Tags and results"
              description="Win rate in matches carrying each tag, against your overall rate."
            />
            <div className="overflow-x-auto p-4 sm:p-5">
              <StatsTable
                caption="Win rate by performance tag"
                columns={[
                  { key: 'label', header: 'Tag' },
                  { key: 'matches', header: 'Matches', align: 'right' },
                  { key: 'winRate', header: 'Win rate', align: 'right' },
                  { key: 'delta', header: 'vs overall', align: 'right' },
                ]}
                rows={(tags.data ?? []).map((entry) => ({
                  key: entry.tag,
                  label: PERFORMANCE_TAG_LABELS[entry.tag],
                  matches: entry.matches,
                  winRate: percent(entry.winRate),
                  delta: entry.winRateDelta === null ? EM_DASH : `${signed(entry.winRateDelta, 1)} pts`,
                }))}
              />
              <p className="mt-3 text-xs text-ink-muted">
                Tags are applied after the fact, so a losing match is more likely to be tagged
                &ldquo;unforced errors&rdquo;. Read these as associations, not causes.
              </p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
