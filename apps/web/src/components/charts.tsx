'use client';

import { useId, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EM_DASH, percent, signed } from '@/lib/format';
import { cx } from './ui';

/**
 * Chart kit.
 *
 * Rules these components enforce so individual pages cannot break them:
 *
 *  - **One axis, always.** No component here accepts a second y-scale. Two measures of
 *    different magnitude get two charts, never two axes on one.
 *  - **Colour by job.** A single series uses the accent hue; two opposed series use the
 *    diverging pair; categories use the fixed slot order and never cycle.
 *  - **Identity never rests on colour alone.** Two or more series always carry a legend,
 *    and every chart is paired with the underlying numbers in text or a table.
 *  - **Hover is standard.** Every chart ships a tooltip; a chart the reader cannot
 *    interrogate is a picture, not an instrument.
 *  - **Unknown is not zero.** Periods with no data are absent from the series rather
 *    than plotted at 0, which would draw a win rate that never happened.
 */

const AXIS_STYLE = { fontSize: 11, fill: 'var(--text-muted)' } as const;
const GRID_STYLE = { stroke: 'var(--grid)', strokeDasharray: '2 4' } as const;

export function ChartFrame({
  title,
  description,
  legend,
  children,
  footer,
  height = 240,
}: {
  title: string;
  description?: string;
  legend?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  height?: number;
}) {
  return (
    <figure className="card overflow-hidden">
      <figcaption className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>
        {legend}
      </figcaption>
      <div className="px-1 py-3 sm:px-2" style={{ height }}>
        {children}
      </div>
      {footer ? (
        <div className="border-t border-line px-4 py-2.5 text-xs text-ink-secondary sm:px-5">
          {footer}
        </div>
      ) : null}
    </figure>
  );
}

/** Legend swatches. Present whenever a chart draws two or more series. */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-line bg-surface-raised px-3 py-2 text-xs shadow-pop">
      {children}
    </div>
  );
}

export function ChartEmpty({ message = 'No data for this period yet.' }: { message?: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-ink-muted">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Win rate over time — one series, so no legend box; the title names it.
// ---------------------------------------------------------------------------

export interface TrendDatum {
  label: string;
  periodStart: string;
  winRate: number | null;
  matches: number;
}

export function WinRateTrend({ data, height = 240 }: { data: TrendDatum[]; height?: number }) {
  // Periods where the rate is unknown are dropped rather than plotted as 0%.
  const points = data.filter((point) => point.winRate !== null);

  if (points.length === 0) return <ChartEmpty />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID_STYLE} vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={{ stroke: 'var(--axis)' }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(value: number) => `${value}%`}
        />
        {/* A 50% reference makes "winning more than losing" readable at a glance. */}
        <ReferenceLine y={50} stroke="var(--axis)" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as TrendDatum | undefined;
            if (!active || !point) return null;
            return (
              <TooltipShell>
                <p className="font-medium text-ink">{point.label}</p>
                <p className="mt-0.5 text-ink-secondary">
                  {percent(point.winRate)} over {point.matches} match
                  {point.matches === 1 ? '' : 'es'}
                </p>
              </TooltipShell>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="winRate"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
          activeDot={{ r: 5, stroke: 'var(--surface-2)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Point differential — diverging around zero, so the sign is the message.
// ---------------------------------------------------------------------------

export function DifferentialBars({
  data,
  height = 220,
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
}) {
  if (data.length === 0) return <ChartEmpty />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID_STYLE} vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
        <ReferenceLine y={0} stroke="var(--axis)" />
        <Tooltip
          cursor={{ fill: 'var(--surface-0)' }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as { label: string; value: number } | undefined;
            if (!active || !point) return null;
            return (
              <TooltipShell>
                <p className="font-medium text-ink">{point.label}</p>
                <p className="mt-0.5 text-ink-secondary">{signed(point.value)} points</p>
              </TooltipShell>
            );
          }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((point) => (
            <Cell
              key={point.label}
              fill={point.value >= 0 ? 'var(--diverge-positive)' : 'var(--diverge-negative)'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Horizontal comparison bars — one hue, magnitude by length. Used for opponents,
// partners and venues, where the reader is ranking rather than telling apart.
// ---------------------------------------------------------------------------

export function RankedBars({
  data,
  valueLabel,
  max = 100,
  formatValue = (value: number) => percent(value),
}: {
  data: Array<{ label: string; value: number | null; detail?: string }>;
  valueLabel: string;
  max?: number;
  formatValue?: (value: number) => string;
}) {
  if (data.length === 0) return <ChartEmpty />;

  return (
    <ul className="space-y-2.5">
      {data.map((row) => {
        const width = row.value === null ? 0 : Math.min(100, (row.value / max) * 100);
        return (
          <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-ink">{row.label}</span>
                {/* Direct label: the number is always visible, never hover-only. */}
                <span className="tabular shrink-0 text-sm font-medium text-ink">
                  {row.value === null ? EM_DASH : formatValue(row.value)}
                </span>
              </div>
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-surface-sunken"
                role="img"
                aria-label={`${row.label}: ${row.value === null ? 'no data' : formatValue(row.value)} ${valueLabel}`}
              >
                <div
                  className="h-full rounded-sm bg-accent"
                  style={{ width: `${width}%` }}
                />
              </div>
              {row.detail ? (
                <p className="mt-0.5 text-xs text-ink-muted">{row.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Games won versus lost — two opposed series, so the diverging pair, a legend and
// direct totals.
// ---------------------------------------------------------------------------

export function WonLostBars({
  data,
  height = 220,
}: {
  data: Array<{ label: string; won: number; lost: number }>;
  height?: number;
}) {
  if (data.length === 0) return <ChartEmpty />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID_STYLE} vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={32} />
        <Tooltip
          cursor={{ fill: 'var(--surface-0)' }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as
              | { label: string; won: number; lost: number }
              | undefined;
            if (!active || !point) return null;
            return (
              <TooltipShell>
                <p className="font-medium text-ink">{point.label}</p>
                <p className="mt-0.5 text-ink-secondary">
                  {point.won} won · {point.lost} lost
                </p>
              </TooltipShell>
            );
          }}
        />
        {/* A 2px surface-coloured gap keeps the two stacked segments visually separate. */}
        <Bar
          dataKey="won"
          stackId="games"
          fill="var(--diverge-positive)"
          stroke="var(--surface-2)"
          strokeWidth={1}
          isAnimationActive={false}
        />
        <Bar
          dataKey="lost"
          stackId="games"
          fill="var(--diverge-negative)"
          stroke="var(--surface-2)"
          strokeWidth={1}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Rating progression — a single series over time.
// ---------------------------------------------------------------------------

export function RatingTrend({
  data,
  height = 220,
}: {
  data: Array<{ playedAt: string; rating: number; result: string }>;
  height?: number;
}) {
  if (data.length < 2) {
    return <ChartEmpty message="A rating history appears once you have recorded a few matches." />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID_STYLE} vertical={false} />
        <XAxis
          dataKey="playedAt"
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={40}
          tickFormatter={(value: string) => value.slice(0, 7)}
        />
        <YAxis
          tick={AXIS_STYLE}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={['dataMin - 30', 'dataMax + 30']}
        />
        <Tooltip
          cursor={{ stroke: 'var(--axis)' }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as
              | { playedAt: string; rating: number; result: string }
              | undefined;
            if (!active || !point) return null;
            return (
              <TooltipShell>
                <p className="font-medium text-ink">{point.rating.toFixed(0)}</p>
                <p className="mt-0.5 text-ink-secondary">
                  {point.playedAt.slice(0, 10)} · {point.result.toLowerCase()}
                </p>
              </TooltipShell>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="rating"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, stroke: 'var(--surface-2)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Activity heatmap — sequential single hue, more sessions means darker.
// ---------------------------------------------------------------------------

const HEAT_STEPS = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)'];

export function ActivityHeatmap({
  days,
  weeks = 27,
}: {
  days: Array<{ date: string; sessions: number; matches: number; wins: number; losses: number }>;
  weeks?: number;
}) {
  const titleId = useId();
  const byDate = new Map(days.map((day) => [day.date, day]));

  // Build a grid ending on the current week, columns = weeks, rows = Mon..Sun.
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const endWeekday = (end.getUTCDay() + 6) % 7; // 0 = Monday
  const gridEnd = new Date(end.getTime() + (6 - endWeekday) * 86_400_000);
  const gridStart = new Date(gridEnd.getTime() - (weeks * 7 - 1) * 86_400_000);

  const columns: Array<Array<{ iso: string; sessions: number; matches: number } | null>> = [];
  for (let week = 0; week < weeks; week += 1) {
    const column: Array<{ iso: string; sessions: number; matches: number } | null> = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(gridStart.getTime() + (week * 7 + day) * 86_400_000);
      if (date > end) {
        column.push(null);
        continue;
      }
      const iso = date.toISOString().slice(0, 10);
      const entry = byDate.get(iso);
      column.push({ iso, sessions: entry?.sessions ?? 0, matches: entry?.matches ?? 0 });
    }
    columns.push(column);
  }

  const step = (sessions: number) => {
    if (sessions === 0) return HEAT_STEPS[0]!;
    if (sessions === 1) return HEAT_STEPS[2]!;
    if (sessions === 2) return HEAT_STEPS[3]!;
    return HEAT_STEPS[4]!;
  };

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div
          role="img"
          aria-labelledby={titleId}
          className="flex min-w-max gap-1"
        >
          <span id={titleId} className="sr-only">
            Activity over the last {weeks} weeks. Darker squares mean more sessions that day.
          </span>
          {columns.map((column, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {column.map((cell, dayIndex) =>
                cell === null ? (
                  <span key={dayIndex} className="h-3 w-3" />
                ) : (
                  <span
                    key={cell.iso}
                    // The title attribute is the hover layer for a grid this dense; a
                    // floating tooltip on 189 cells costs more than it gives.
                    title={`${cell.iso}: ${cell.sessions} session${cell.sessions === 1 ? '' : 's'}, ${cell.matches} match${cell.matches === 1 ? '' : 'es'}`}
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: step(cell.sessions) }}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-ink-muted">
        <span>Less</span>
        {HEAT_STEPS.map((color) => (
          <span
            key={color}
            aria-hidden="true"
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: color }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fatigue — performance by position within a session.
// ---------------------------------------------------------------------------

export function SessionPositionBars({
  buckets,
}: {
  buckets: Array<{ matchNumber: number; winRate: number | null; matches: number }>;
}) {
  if (buckets.length === 0) return <ChartEmpty />;

  return (
    <ul className="space-y-2.5">
      {buckets.map((bucket) => (
        <li key={bucket.matchNumber} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs text-ink-muted">
            Match {bucket.matchNumber}
          </span>
          <div className="h-6 flex-1 overflow-hidden rounded-sm bg-surface-sunken">
            <div
              className="flex h-full items-center justify-end rounded-sm bg-accent px-2"
              style={{ width: `${bucket.winRate ?? 0}%` }}
            />
          </div>
          <span className="tabular w-24 shrink-0 text-right text-xs text-ink-secondary">
            {percent(bucket.winRate)} · {bucket.matches}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ChartTableToggle({
  showTable,
  onToggle,
}: {
  showTable: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cx(
        'rounded-sm border border-line px-2 py-1 text-xs text-ink-secondary',
        'hover:border-line-strong',
      )}
      aria-pressed={showTable}
    >
      {showTable ? 'Show chart' : 'Show table'}
    </button>
  );
}
