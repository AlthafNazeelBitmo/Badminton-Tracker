'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarRange,
  Clock3,
  Eye,
  Flame,
  Lightbulb,
  Plus,
  Snowflake,
  Sparkles,
  Swords,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { Insight } from '@badminton/contracts';
import {
  useFilterState,
  useHeatmap,
  useInsights,
  useMatches,
  useOverview,
  useRatingHistory,
  useSession,
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
  Avatar,
  Card,
  CardHeader,
  Delta,
  EmptyState,
  ErrorState,
  FormStrip,
  ResultBadge,
  Ring,
  Skeleton,
  Stat,
  buttonClass,
  cx,
} from '@/components/ui';
import { FilterBar } from '@/components/filter-bar';

/**
 * The dashboard answers, in order and without scrolling past anything important:
 * am I winning, am I improving, how much am I playing, and what should I look at next.
 *
 * Hierarchy is deliberate. One hero card carries the headline — win rate and current
 * form — with rating beside it; four secondary figures sit in a quieter strip below.
 * Eight equal tiles would make every number shout at the same volume.
 */
export default function DashboardPage() {
  const { filter, update, query } = useFilterState({ preset: 'LAST_90_DAYS' });
  const { user } = useSession();

  const overview = useOverview(query);
  const trend = useTrend(query, 'MONTH');
  const insights = useInsights(query);
  const heatmap = useHeatmap('?preset=THIS_YEAR&timeZone=UTC');
  const recent = useMatches('?pageSize=10&sort=NEWEST');
  const ratings = useRatingHistory();

  const stats = overview.data?.stats;
  const streaks = overview.data?.streaks;

  const winRateDelta = useMemo(() => {
    const current = overview.data?.stats.winRate;
    const previous = overview.data?.previousPeriod?.winRate;
    if (current === null || current === undefined) return null;
    if (previous === null || previous === undefined) return null;
    return current - previous;
  }, [overview.data]);

  const form = useMemo(
    () => (recent.data?.items ?? []).map((match) => match.derived.result).reverse(),
    [recent.data],
  );

  if (overview.error) {
    return <ErrorState error={overview.error as Error} onRetry={() => void overview.mutate()} />;
  }

  const hasMatches = (stats?.matches ?? 0) > 0;
  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{todayLabel()}</p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1.5 text-sm text-ink-secondary">
            {overview.data?.lastMatchAt
              ? `Your last match was on ${formatShortDate(overview.data.lastMatchAt)}.`
              : 'Record your first match to start building a picture.'}
          </p>
        </div>
      </header>

      <FilterBar filter={filter} onChange={update} className="mb-6" />

      {overview.isLoading && !overview.data ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-[236px] lg:col-span-7" />
          <Skeleton className="h-[236px] lg:col-span-5" />
          <div className="grid grid-cols-2 gap-4 lg:col-span-12 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[124px]" />
            ))}
          </div>
        </div>
      ) : !hasMatches ? (
        <Card>
          <EmptyState
            icon={<Activity />}
            title="No matches in this period"
            description="Record a match and the dashboard fills in immediately — win rate, streaks, opponents and trends all come from the scores you enter."
            action={
              <Link href="/record" className={buttonClass('primary')}>
                <Plus strokeWidth={2.5} />
                Record a match
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Am I winning? */}
          <section aria-label="Headline" className="grid gap-4 lg:grid-cols-12">
            <div className="card relative overflow-hidden p-5 sm:p-6 lg:col-span-7">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <Ring
                  value={
                    stats?.winRate === null || stats?.winRate === undefined
                      ? null
                      : stats.winRate / 100
                  }
                  label={`Win rate ${percent(stats?.winRate)}`}
                >
                  <span className="tabular text-[30px] font-semibold leading-none tracking-[-0.04em]">
                    {percent(stats?.winRate, 0)}
                  </span>
                  <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                    Win rate
                  </span>
                </Ring>

                <div className="min-w-0 flex-1 space-y-5">
                  <div>
                    <p className="eyebrow">Record</p>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="tabular text-hero">
                        {stats?.wins ?? 0}
                        <span className="text-ink-muted">–</span>
                        {stats?.losses ?? 0}
                      </p>
                      {winRateDelta !== null ? (
                        <span className="text-xs">
                          <Delta value={winRateDelta} />{' '}
                          <span className="text-ink-muted">vs previous</span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="eyebrow">Last {form.length}</p>
                      <StreakPill current={streaks?.current ?? 0} />
                    </div>
                    {recent.isLoading && !recent.data ? (
                      <Skeleton className="h-6 w-64" />
                    ) : (
                      <FormStrip results={form} />
                    )}
                    <p className="mt-2 text-xs text-ink-muted">
                      Best run {streaks?.bestWinStreak ?? 0} wins · longest slump{' '}
                      {streaks?.worstLossStreak ?? 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <RatingCard
              rating={overview.data?.rating.overall ?? null}
              deviation={overview.data?.rating.deviation ?? null}
              history={ratings.data ?? []}
            />
          </section>

          {/* Supporting figures, quieter than the headline. */}
          <section aria-label="Statistics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Matches"
              icon={<CalendarRange />}
              value={stats?.matches ?? 0}
              detail={`${overview.data?.sessions ?? 0} sessions`}
            />
            <Stat
              label="Games won"
              icon={<Target />}
              value={percent(stats?.gameWinRate)}
              detail={`${stats?.gamesWon ?? 0}–${stats?.gamesLost ?? 0} in games`}
            />
            <Stat
              label="Point diff"
              icon={<TrendingUp />}
              value={signed(stats?.pointDifferential)}
              detail={`${percent(stats?.pointWinRate)} of points won`}
              tone={
                (stats?.pointDifferential ?? 0) > 0
                  ? 'win'
                  : (stats?.pointDifferential ?? 0) < 0
                    ? 'loss'
                    : 'neutral'
              }
            />
            <Stat
              label="Court time"
              icon={<Clock3 />}
              value={totalTime(stats?.playingSeconds)}
              detail={
                stats?.averageMatchSeconds
                  ? `${Math.round(stats.averageMatchSeconds / 60)} min per match · ${overview.data?.distinctOpponents ?? 0} opponents`
                  : 'Not timed'
              }
            />
          </section>

          {/* Am I improving? */}
          <section className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <ChartFrame
                title="Win rate over time"
                description="Monthly. Months with no matches are left out rather than drawn as zero."
                height={260}
                footer={
                  trend.data?.winRateTrendPerPeriod === null ||
                  trend.data?.winRateTrendPerPeriod === undefined ? (
                    <>Not enough months yet to describe a direction.</>
                  ) : (
                    <>
                      Trend{' '}
                      <span className="tabular font-medium text-ink">
                        {signed(trend.data.winRateTrendPerPeriod, 1)} pts
                      </span>{' '}
                      per month across {trend.data.points.length} months.
                    </>
                  )
                }
              >
                {trend.isLoading && !trend.data ? (
                  <Skeleton className="h-full" />
                ) : (
                  <WinRateTrend
                    height={236}
                    data={(trend.data?.points ?? []).map((point) => ({
                      label: point.label.replace(/ \d{4}$/, ''),
                      periodStart: point.periodStart,
                      winRate: point.stats.winRate,
                      matches: point.stats.matches,
                    }))}
                  />
                )}
              </ChartFrame>
            </div>

            <Card className="flex flex-col lg:col-span-5">
              <CardHeader
                icon={<Sparkles />}
                title="What the data says"
                description="Each claim shows its sample size."
              />
              <div className="max-h-[340px] flex-1 overflow-y-auto px-3 pb-3 pt-2">
                {insights.isLoading && !insights.data ? (
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                ) : (insights.data?.length ?? 0) === 0 ? (
                  <p className="p-2 text-sm text-ink-secondary">
                    Nothing meets the evidence threshold yet. Insights appear once there are enough
                    matches to say something real.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {insights.data!.slice(0, 6).map((insight) => (
                      <InsightItem key={insight.id} insight={insight} />
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </section>

          {/* How much am I playing? */}
          <section className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-5">
              <CardHeader
                icon={<Swords />}
                title="Recent matches"
                action={
                  <Link
                    href="/matches"
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary hover:text-ink"
                  >
                    View all <ArrowRight className="size-3.5" />
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
                <ul className="p-2">
                  {(recent.data?.items ?? []).slice(0, 5).map((match) => {
                    const names = match.opponents.map((person) => person.name);
                    return (
                      <li key={match.id}>
                        <Link
                          href={`/matches/${match.id}`}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-ink/[0.04]"
                        >
                          <div className="flex -space-x-2">
                            {names.slice(0, 2).map((name) => (
                              <Avatar
                                key={name}
                                name={name}
                                size="sm"
                                className="ring-2 ring-surface-raised"
                              />
                            ))}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">
                              {joinNames(names)}
                            </p>
                            <p className="tabular truncate font-mono text-xs text-ink-muted">
                              {scoreline(match.games)}
                            </p>
                          </div>
                          <span className="hidden shrink-0 text-xs text-ink-muted sm:block">
                            {formatShortDate(match.playedAt)}
                          </span>
                          <ResultBadge result={match.derived.result} size="sm" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="lg:col-span-7">
              <ChartFrame
                title="Playing frequency"
                description="Sessions per day this year."
                height={168}
                footer={
                  heatmap.data ? (
                    <>
                      <span className="tabular font-medium text-ink">
                        {heatmap.data.averageSessionsPerWeek ?? 0}
                      </span>{' '}
                      sessions per week on average
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
            </div>
          </section>
        </div>
      )}

      <div className="mt-8">
        <SecondaryNav />
      </div>
    </>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

function StreakPill({ current }: { current: number }) {
  if (current === 0) {
    return <span className="text-xs text-ink-muted">No current streak</span>;
  }
  const winning = current > 0;
  const Icon = winning ? Flame : Snowflake;
  const count = Math.abs(current);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        winning ? 'bg-win-soft text-win' : 'bg-loss-soft text-loss',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {count} {winning ? 'win' : 'loss'}
      {count === 1 ? '' : winning ? 's' : 'es'} in a row
    </span>
  );
}

/**
 * Rating, on the one dark card of the page: the number a player watches most, set apart
 * the way fitness products set apart their headline score.
 */
function RatingCard({
  rating,
  deviation,
  history,
}: {
  rating: number | null;
  deviation: number | null;
  history: Array<{ ratingAfter: number; delta: number; discipline: string }>;
}) {
  // One discipline's history, so the line is a single rating rather than several
  // interleaved ones — the discipline played most recently.
  const series = useMemo(() => {
    const last = history[history.length - 1];
    if (!last) return [];
    return history.filter((point) => point.discipline === last.discipline).slice(-24);
  }, [history]);

  const recentChange = series.slice(-10).reduce((sum, point) => sum + point.delta, 0);

  return (
    <div className="relative overflow-hidden rounded-xl border border-black/80 bg-[#0c0d0f] p-5 text-white shadow-lift dark:border-line dark:bg-surface-overlay sm:p-6 lg:col-span-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-[radial-gradient(closest-side,rgb(205_242_75/0.28),transparent)]"
      />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">
            Rating
          </p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
            ±{deviation ?? EM_DASH}
          </span>
        </div>
        <p className="tabular mt-3 text-display text-white">
          {rating === null ? EM_DASH : Math.round(rating)}
        </p>
        <p className="mt-2 text-xs text-white/60">
          {series.length >= 2 ? (
            <>
              <span
                className={cx(
                  'tabular font-semibold',
                  recentChange >= 0 ? 'text-[#cdf24b]' : 'text-[#fb7185]',
                )}
              >
                {signed(Math.round(recentChange))}
              </span>{' '}
              over the last {Math.min(10, series.length)} rated matches
            </>
          ) : (
            'Estimated from your results against rated opponents.'
          )}
        </p>
        <div className="mt-auto pt-4">
          <Sparkline values={series.map((point) => point.ratingAfter)} />
        </div>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-14" />;
  const width = 320;
  const height = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 4 - ((value - min) / span) * (height - 8),
  ]);
  const line = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x!.toFixed(1)},${y!.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-14 w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cdf24b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#cdf24b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="#cdf24b"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="3.5"
        fill="#cdf24b"
        stroke="#0c0d0f"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * An insight, labelled with how strong a claim it is making. The distinction between
 * "the data says" and "this might mean" is shown, never blurred.
 */
function InsightItem({ insight }: { insight: Insight }) {
  const kind = {
    OBSERVATION: { label: 'Observed', icon: Eye },
    INTERPRETATION: { label: 'Interpretation', icon: Lightbulb },
    RECOMMENDATION: { label: 'Suggestion', icon: Sparkles },
  }[insight.kind];
  const Icon = kind.icon;

  const tone =
    insight.kind === 'RECOMMENDATION'
      ? 'bg-accent-soft text-accent-text'
      : insight.sentiment === 'POSITIVE'
        ? 'bg-win-soft text-win'
        : insight.sentiment === 'NEGATIVE'
          ? 'bg-loss-soft text-loss'
          : 'bg-surface-sunken text-ink-secondary';

  return (
    <li className="flex gap-3 rounded-lg p-2.5 transition-colors hover:bg-ink/[0.03]">
      <span
        className={cx('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', tone)}
        title={kind.label}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-snug text-ink">{insight.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{insight.detail}</p>
        <p className="mt-1 text-[11px] font-medium text-ink-muted">
          <span className="sr-only">{kind.label}. </span>
          {kind.label} · n={insight.sampleSize}
        </p>
      </div>
    </li>
  );
}
