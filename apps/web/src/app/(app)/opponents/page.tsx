'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { BreakdownEntry, PlayerSubject } from '@badminton/contracts';
import { useFilterState, useOpponents, usePartners } from '@/lib/hooks';
import { EM_DASH, formatShortDate, percent, signed } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';
import { RankedBars } from '@/components/charts';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  cx,
} from '@/components/ui';
import { StatsTable } from '@/components/stats-table';

/**
 * Head-to-head and partnership records.
 *
 * Opponents and partners share a page because they are the same question asked two
 * ways — "how do I do against this person" and "how do I do with them" — and the same
 * person often appears in both.
 */
export default function OpponentsPage() {
  const { filter, update, query } = useFilterState({ preset: 'ALL_TIME' });
  const [tab, setTab] = useState<'opponents' | 'partners'>('opponents');
  const [minMatches, setMinMatches] = useState(1);

  const opponents = useOpponents(query);
  const partners = usePartners(query);

  const active = tab === 'opponents' ? opponents : partners;
  const entries = (active.data ?? []).filter((entry) => entry.stats.matches >= minMatches);

  if (active.error) {
    return <ErrorState error={active.error as Error} onRetry={() => void active.mutate()} />;
  }

  return (
    <>
      <PageHeader
        title="People"
        description="Your record against every opponent, and with every partner."
      />

      <FilterBar filter={filter} onChange={update} className="mb-4" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="View" className="flex gap-1">
          {(
            [
              ['opponents', 'Opponents'],
              ['partners', 'Partners'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cx(
                'rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors',
                tab === value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-secondary hover:border-line-strong',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          Minimum matches
          <select
            value={minMatches}
            onChange={(event) => setMinMatches(Number(event.target.value))}
            className="h-9 rounded border border-line bg-surface-raised px-2 text-xs"
          >
            {[1, 3, 5, 10].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {active.isLoading && !active.data ? (
        <div className="space-y-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            title={tab === 'opponents' ? 'No opponents yet' : 'No doubles partners yet'}
            description={
              tab === 'opponents'
                ? 'Record a match and your head-to-head record starts building here.'
                : 'Record a doubles match and partnership records appear here.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Ranked comparison. One hue, length carries magnitude, numbers always shown. */}
          <Card>
            <CardHeader
              title={tab === 'opponents' ? 'Win rate by opponent' : 'Win rate by partner'}
              description={`Only people played at least ${minMatches} time${minMatches === 1 ? '' : 's'}.`}
            />
            <div className="p-4 sm:p-5">
              <RankedBars
                valueLabel="win rate"
                data={[...entries]
                  .sort((a, b) => (b.stats.winRate ?? -1) - (a.stats.winRate ?? -1))
                  .slice(0, 12)
                  .map((entry) => ({
                    label: entry.subject.name,
                    value: entry.stats.winRate,
                    detail: `${entry.stats.wins}W–${entry.stats.losses}L · ${signed(
                      entry.stats.pointDifferential,
                    )} points`,
                  }))}
              />
            </div>
          </Card>

          {/* Full detail */}
          <Card>
            <CardHeader title="Full record" />
            <div className="overflow-x-auto p-4 sm:p-5">
              <StatsTable
                caption={
                  tab === 'opponents' ? 'Record against each opponent' : 'Record with each partner'
                }
                columns={[
                  { key: 'name', header: tab === 'opponents' ? 'Opponent' : 'Partner' },
                  { key: 'matches', header: 'Played', align: 'right' },
                  { key: 'record', header: 'W–L', align: 'right' },
                  { key: 'winRate', header: 'Win rate', align: 'right' },
                  { key: 'games', header: 'Games', align: 'right' },
                  { key: 'diff', header: 'Diff', align: 'right' },
                  { key: 'streak', header: 'Streak', align: 'right' },
                  { key: 'last', header: 'Last played', align: 'right' },
                ]}
                rows={entries.map((entry) => ({
                  key: entry.subject.id,
                  name: (
                    <Link
                      href={`/matches?${tab === 'opponents' ? 'opponentId' : 'partnerId'}=${entry.subject.id}`}
                      className="text-accent hover:underline"
                    >
                      {entry.subject.name}
                    </Link>
                  ),
                  matches: entry.stats.matches,
                  record: `${entry.stats.wins}–${entry.stats.losses}`,
                  winRate: percent(entry.stats.winRate),
                  games: `${entry.stats.gamesWon}–${entry.stats.gamesLost}`,
                  diff: signed(entry.stats.pointDifferential),
                  streak: <StreakCell value={entry.streaks.current} />,
                  last: formatShortDate(entry.lastPlayedAt),
                }))}
              />
            </div>
          </Card>

          {/* Best and worst results per person */}
          <Card>
            <CardHeader
              title="Best and worst"
              description="Largest and smallest point differential against each person."
            />
            <ul className="divide-y divide-line">
              {entries.slice(0, 8).map((entry) => (
                <BestWorstRow key={entry.subject.id} entry={entry} />
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

function StreakCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-muted">{EM_DASH}</span>;
  const winning = value > 0;
  return (
    <span className={winning ? 'text-win' : 'text-loss'}>
      {Math.abs(value)}
      {winning ? 'W' : 'L'}
      <span className="sr-only">{winning ? ' win streak' : ' loss streak'}</span>
    </span>
  );
}

function BestWorstRow({ entry }: { entry: BreakdownEntry<PlayerSubject> }) {
  return (
    <li className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-center sm:px-5">
      <p className="text-sm font-medium text-ink">{entry.subject.name}</p>
      <p className="text-xs text-ink-secondary">
        <span className="text-ink-muted">Best </span>
        {entry.bestResult ? (
          <Link href={`/matches/${entry.bestResult.matchId}`} className="hover:underline">
            {entry.bestResult.score} ({signed(entry.bestResult.margin)})
          </Link>
        ) : (
          EM_DASH
        )}
      </p>
      <p className="text-xs text-ink-secondary">
        <span className="text-ink-muted">Worst </span>
        {entry.worstResult ? (
          <Link href={`/matches/${entry.worstResult.matchId}`} className="hover:underline">
            {entry.worstResult.score} ({signed(entry.worstResult.margin)})
          </Link>
        ) : (
          EM_DASH
        )}
      </p>
    </li>
  );
}
