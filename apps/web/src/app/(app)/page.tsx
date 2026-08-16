'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { Insight } from '@badminton/contracts';
import {
  useFilterState,
  useHeatmap,
  useInsights,
  useMatches,
  useOverview,
  useTrend,
} from '@/lib/hooks';
import {
  EM_DASH,
  formatShortDate,
  joinNames,
  percent,
  scoreline,
  signed,
  totalTime,
} from '@/lib/format';
import { ActivityHeatmap, ChartFrame, WinRateTrend } from '@/components/charts';
import { SecondaryNav } from '@/components/app-shell';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ResultBadge,
  Skeleton,
  Stat,
} from '@/components/ui';
import { FilterBar } from '@/components/filter-bar';

/**
 * The dashboard answers, in order and without scrolling past anything important:
 * how much am I playing, am I winning, am I improving, and what should I look at next.
 * Everything below the fold is detail, not the headline.
 */
export default function DashboardPage() {
  const { filter, update, query } = useFilterState({ preset: 'LAST_90_DAYS' });

  const overview = useOverview(query);
  const trend = useTrend(query, 'MONTH');
  const insights = useInsights(query);
  const heatmap = useHeatmap('?preset=THIS_YEAR&timeZone=UTC');
  const recent = useMatches('?pageSize=5&sort=NEWEST');

  const stats = overview.data?.stats;
  const streaks = overview.data?.streaks;

  const winRateDelta = useMemo(() => {
    const current = overview.data?.stats.winRate;
    const previous = overview.data?.previousPeriod?.winRate;
    if (current === null || current === undefined) return null;
    if (previous === null || previous === undefined) return null;
    return current - previous;
  }, [overview.data]);

  if (overview.error) {
    return <ErrorState error={overview.error as Error} onRetry={() => void overview.mutate()} />;
  }

  const hasMatches = (stats?.matches ?? 0) > 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {overview.data?.lastMatchAt
              ? `Last match ${formatShortDate(overview.data.lastMatchAt)}.`
              : 'Record your first match to start building a picture.'}
          </p>
        </div>
        <Link
          href="/record"
          className="hidden h-11 items-center rounded bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90 lg:inline-flex"
        >
          Record a match
        </Link>
      </div>

      <FilterBar filter={filter} onChange={update} className="mb-5" />

      {overview.isLoading && !overview.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : !hasMatches ? (
        <Card>
          <EmptyState
            title="No matches in this period"
            description="Record a match and the dashboard fills in immediately — win rate, streaks, opponents and trends all come from the scores you enter."
            action={
              <Link
                href="/record"
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
              >
                Record a match
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {/* Am I winning? */}
          <section
            aria-label="Headline statistics"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <Stat
              label="Win rate"
              value={percent(stats?.winRate)}
              detail={`${stats?.wins ?? 0}W · ${stats?.losses ?? 0}L`}
              delta={winRateDelta}
            />
            <Stat
              label="Matches"
              value={stats?.matches ?? 0}
              detail={`${overview.data?.sessions ?? 0} sessions`}
            />
            <Stat
              label="Games"
              value={percent(stats?.gameWinRate)}
              detail={`${stats?.gamesWon ?? 0}–${stats?.gamesLost ?? 0}`}
            />
            <Stat
              label="Point differential"
              value={signed(stats?.pointDifferential)}
              detail={`${percent(stats?.pointWinRate)} of points`}
              tone={
                (stats?.pointDifferential ?? 0) > 0
                  ? 'win'
                  : (stats?.pointDifferential ?? 0) < 0
                    ? 'loss'
                    : 'neutral'
              }
            />
          </section>

          {/* Current form */}
          <section className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StreakCard
              current={streaks?.current ?? 0}
              best={streaks?.bestWinStreak ?? 0}
              worst={streaks?.worstLossStreak ?? 0}
            />
            <Stat
              label="Playing time"
              value={totalTime(stats?.playingSeconds)}
              detail={
                stats?.averageMatchSeconds
                  ? `${Math.round(stats.averageMatchSeconds / 60)} min average`
                  : 'Not timed'
              }
            />
            <Stat
              label="Rating"
              value={overview.data?.rating.overall ?? EM_DASH}
              detail={`Estimated, ±${overview.data?.rating.deviation ?? 0}`}
            />
            <Stat
              label="People & places"
              value={`${overview.data?.distinctOpponents ?? 0}`}
              detail={`opponents · ${overview.data?.distinctVenues ?? 0} venues`}
            />
          </section>

          {/* Am I improving? */}
          <section className="mt-5 grid gap-4 lg:grid-cols-[3fr_2fr]">
            <ChartFrame
              title="Win rate over time"
              description="Monthly. Months with no matches are left out rather than drawn as zero."
              footer={
                trend.data?.winRateTrendPerPeriod === null ||
                trend.data?.winRateTrendPerPeriod === undefined ? (
                  <>Not enough months yet to describe a direction.</>
                ) : (
                  <>
                    Trend {signed(trend.data.winRateTrendPerPeriod, 1)} percentage points per month
                    across {trend.data.points.length} months.
                  </>
                )
              }
            >
              {trend.isLoading && !trend.data ? (
                <Skeleton className="h-full" />
              ) : (
                <WinRateTrend
                  data={(trend.data?.points ?? []).map((point) => ({
                    label: point.label.replace(/ \d{4}$/, ''),
                    periodStart: point.periodStart,
                    winRate: point.stats.winRate,
                    matches: point.stats.matches,
                  }))}
                />
              )}
            </ChartFrame>

            <Card>
              <CardHeader
                title="What the data says"
                description="Observations, interpretations and one suggestion — each with its numbers."
              />
              <div className="max-h-[19rem] overflow-y-auto p-4 sm:p-5">
                {insights.isLoading && !insights.data ? (
                  <div className="space-y-3">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                  </div>
                ) : (insights.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-ink-secondary">
                    Nothing meets the evidence threshold yet. Insights appear once there are enough
                    matches to say something real.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {insights.data!.slice(0, 5).map((insight) => (
                      <InsightItem key={insight.id} insight={insight} />
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </section>

          {/* How much am I playing? */}
          <section className="mt-4 grid gap-4 lg:grid-cols-[2fr_3fr]">
            <Card>
              <CardHeader
                title="Recent matches"
                action={
                  <Link href="/matches" className="text-xs font-medium text-accent hover:underline">
                    See all
                  </Link>
                }
              />
              {recent.isLoading && !recent.data ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {(recent.data?.items ?? []).map((match) => (
                    <li key={match.id}>
                      <Link
                        href={`/matches/${match.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken sm:px-5"
                      >
                        <ResultBadge result={match.derived.result} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-ink">
                            {joinNames(match.opponents.map((person) => person.name))}
                          </p>
                          <p className="tabular truncate text-xs text-ink-muted">
                            {scoreline(match.games)}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-ink-muted">
                          {formatShortDate(match.playedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <ChartFrame
              title="Playing frequency"
              description="Sessions per day this year."
              height={160}
              footer={
                heatmap.data ? (
                  <>
                    {heatmap.data.averageSessionsPerWeek ?? 0} sessions per week on average
                    {heatmap.data.mostActiveMonth
                      ? ` · busiest month ${heatmap.data.mostActiveMonth.month}`
                      : ''}
                  </>
                ) : null
              }
            >
              {heatmap.isLoading && !heatmap.data ? (
                <Skeleton className="h-full" />
              ) : (
                <div className="px-3">
                  <ActivityHeatmap days={heatmap.data?.days ?? []} />
                </div>
              )}
            </ChartFrame>
          </section>
        </>
      )}

      <div className="mt-6">
        <SecondaryNav />
      </div>
    </>
  );
}

function StreakCard({ current, best, worst }: { current: number; best: number; worst: number }) {
  const winning = current > 0;
  const losing = current < 0;

  return (
    <div className="card card-pad">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Current streak</p>
      <p
        className={`mt-1.5 text-stat font-semibold ${
          winning ? 'text-win' : losing ? 'text-loss' : 'text-ink'
        }`}
      >
        {current === 0 ? (
          'None'
        ) : (
          <>
            <span aria-hidden="true">{winning ? '🔥 ' : ''}</span>
            {Math.abs(current)} {winning ? 'win' : 'loss'}
            {Math.abs(current) === 1 ? '' : 'es'}
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-ink-secondary">
        Best {best} · worst run {worst}
      </p>
    </div>
  );
}

/**
 * An insight, labelled with how strong a claim it is making. The distinction between
 * "the data says" and "this might mean" is shown, never blurred.
 */
function InsightItem({ insight }: { insight: Insight }) {
  const kindLabel = {
    OBSERVATION: 'Observed',
    INTERPRETATION: 'Interpretation',
    RECOMMENDATION: 'Suggestion',
  }[insight.kind];

  const tone =
    insight.sentiment === 'POSITIVE'
      ? 'win'
      : insight.sentiment === 'NEGATIVE'
        ? 'loss'
        : 'neutral';

  return (
    <li className="border-l-2 border-line pl-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={insight.kind === 'RECOMMENDATION' ? 'accent' : tone}>{kindLabel}</Badge>
        <span className="text-xs text-ink-muted">n={insight.sampleSize}</span>
      </div>
      <p className="text-sm font-medium text-ink">{insight.title}</p>
      <p className="mt-0.5 text-xs text-ink-secondary">{insight.detail}</p>
    </li>
  );
}
