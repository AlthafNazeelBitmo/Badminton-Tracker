'use client';

import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SESSION_TYPE_LABELS } from '@badminton/contracts';
import { buildQuery } from '@/lib/api';
import { useSessions } from '@/lib/hooks';
import { EM_DASH, duration, formatDate, percent, signed } from '@/lib/format';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  ResultBadge,
  Skeleton,
  cx,
} from '@/components/ui';
import { useMatches } from '@/lib/hooks';

/**
 * Calendar of sessions.
 *
 * A month grid where each day carries what actually happened, so scanning back through
 * a season is visual rather than a list of dates. Selecting a day shows its sessions and
 * every match played.
 */
export default function CalendarPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  });
  const [selected, setSelected] = useState<string | null>(null);

  const range = useMemo(() => {
    const from = new Date(Date.UTC(month.year, month.month - 1, 1));
    const to = new Date(Date.UTC(month.year, month.month, 0));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [month]);

  const sessions = useSessions(
    buildQuery({ from: range.from, to: range.to, pageSize: 100, sort: 'OLDEST' }),
  );

  const dayMatches = useMatches(
    selected
      ? buildQuery({
          from: selected,
          to: `${selected}T23:59:59.999Z`,
          pageSize: 50,
          sort: 'OLDEST',
        })
      : '?pageSize=1',
  );

  const byDate = useMemo(() => {
    const map = new Map<
      string,
      typeof sessions.data extends undefined ? never : NonNullable<typeof sessions.data>['items']
    >();
    for (const session of sessions.data?.items ?? []) {
      const list = map.get(session.date) ?? [];
      list.push(session);
      map.set(session.date, list);
    }
    return map;
  }, [sessions.data]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const grid = useMemo(() => buildMonthGrid(month.year, month.month), [month]);

  const shift = (delta: number) => {
    setSelected(null);
    setMonth((current) => {
      const date = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    });
  };

  if (sessions.error) {
    return <ErrorState error={sessions.error as Error} onRetry={() => void sessions.mutate()} />;
  }

  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(month.year, month.month - 1, 1)),
  );

  return (
    <>
      <PageHeader title="Calendar" description="Every session, month by month." />

      <Card className="mb-4">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="rounded px-3 py-1.5 text-sm text-ink-secondary hover:bg-ink/[0.04]"
          >
            ←
          </button>
          <h2 className="text-sm font-semibold text-ink">{monthLabel}</h2>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="rounded px-3 py-1.5 text-sm text-ink-secondary hover:bg-ink/[0.04]"
          >
            →
          </button>
        </div>

        {sessions.isLoading && !sessions.data ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="p-2 sm:p-4">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-ink-muted">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {grid.map((cell, index) => {
                if (!cell) return <div key={`blank-${index}`} className="h-16 sm:h-24" />;

                const daySessions = byDate.get(cell) ?? [];
                const matches = daySessions.reduce(
                  (total, session) => total + session.stats.matches,
                  0,
                );
                const wins = daySessions.reduce((total, session) => total + session.stats.wins, 0);
                const isSelected = selected === cell;
                const hasPlay = matches > 0;

                return (
                  <button
                    key={cell}
                    type="button"
                    onClick={() => setSelected(isSelected ? null : cell)}
                    aria-pressed={isSelected}
                    aria-label={`${formatDate(cell)}${hasPlay ? `, ${matches} matches, ${wins} won` : ', no matches'}`}
                    className={cx(
                      'group relative flex h-16 flex-col items-start justify-between rounded-xl border p-2 text-left transition-all duration-150 sm:h-24 sm:p-2.5',
                      isSelected
                        ? 'border-ink bg-ink text-[var(--surface-2)] shadow-lift'
                        : hasPlay
                          ? wins * 2 >= matches
                            ? 'border-win/20 bg-win-soft hover:-translate-y-px hover:shadow-lift'
                            : 'border-loss/20 bg-loss-soft hover:-translate-y-px hover:shadow-lift'
                          : 'border-transparent text-ink-muted hover:border-line',
                    )}
                  >
                    <span
                      className={cx(
                        'tabular text-xs sm:text-[13px]',
                        hasPlay || isSelected ? 'font-semibold' : '',
                        cell === todayIso
                          ? 'flex size-6 items-center justify-center rounded-full bg-accent text-accent-ink'
                          : '',
                      )}
                    >
                      {Number(cell.slice(8, 10))}
                    </span>
                    {hasPlay ? (
                      <span className="w-full">
                        <span
                          className={cx(
                            'tabular hidden text-[11px] font-medium sm:block',
                            isSelected
                              ? 'opacity-70'
                              : wins * 2 >= matches
                                ? 'text-win'
                                : 'text-loss',
                          )}
                        >
                          {wins}–{matches - wins}
                        </span>
                        <span className="mt-1 flex gap-0.5" aria-hidden="true">
                          {Array.from({ length: Math.min(matches, 8) }).map((_, dot) => (
                            <span
                              key={dot}
                              className={cx(
                                'size-1.5 rounded-full',
                                dot < wins ? 'bg-win' : 'bg-loss/60',
                                isSelected && 'opacity-80',
                              )}
                            />
                          ))}
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {selected ? (
        <Card>
          <CardHeader
            title={formatDate(selected, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            description={`${(byDate.get(selected) ?? []).length} session(s)`}
          />

          {(byDate.get(selected) ?? []).length === 0 ? (
            <EmptyState title="Nothing recorded on this day" icon={<CalendarDays />} />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {(byDate.get(selected) ?? []).map((session) => (
                  <li key={session.id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {session.venue?.name ?? 'Unspecified venue'}
                        <span className="ml-2 text-xs font-normal text-ink-muted">
                          {SESSION_TYPE_LABELS[session.sessionType]}
                        </span>
                      </p>
                      <p className="text-xs text-ink-secondary">
                        {session.stats.wins}W–{session.stats.losses}L ·{' '}
                        {percent(session.stats.winRate)} · {signed(session.stats.pointDifferential)}{' '}
                        pts ·{' '}
                        {session.stats.durationMinutes
                          ? duration(session.stats.durationMinutes * 60)
                          : EM_DASH}
                      </p>
                    </div>
                    {session.notes ? (
                      <p className="mt-1 text-xs text-ink-secondary">{session.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>

              <div className="border-t border-line">
                <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted sm:px-5">
                  Matches
                </p>
                <ul className="divide-y divide-line">
                  {(dayMatches.data?.items ?? []).map((match) => (
                    <li key={match.id}>
                      <Link
                        href={`/matches/${match.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink/[0.04] sm:px-5"
                      >
                        <ResultBadge result={match.derived.result} />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">
                          {match.opponents.map((person) => person.name).join(' & ')}
                        </span>
                        <span className="tabular shrink-0 text-xs text-ink-secondary">
                          {match.games
                            .map((game) => `${game.myScore}–${game.opponentScore}`)
                            .join(', ')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}

/** Month grid padded to whole weeks, Monday first. Empty slots are null. */
function buildMonthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;

  const cells: Array<string | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}
