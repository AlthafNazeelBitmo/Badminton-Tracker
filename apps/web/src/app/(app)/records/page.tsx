'use client';

import Link from 'next/link';
import { useAchievements, useFilterState, useRecords } from '@/lib/hooks';
import { formatShortDate } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Meter,
  PageHeader,
  Skeleton,
} from '@/components/ui';

/**
 * Personal records and achievements.
 *
 * Nothing on this page is stored. Records are recomputed from raw matches on every
 * request, so editing or deleting a match immediately and correctly changes the record
 * it used to hold — no stale "best ever" that no longer exists in the data.
 */
export default function RecordsPage() {
  const { filter, update, query } = useFilterState({ preset: 'ALL_TIME' });
  const records = useRecords(query);
  const achievements = useAchievements();

  if (records.error) {
    return <ErrorState error={records.error as Error} onRetry={() => void records.mutate()} />;
  }

  const unlocked = (achievements.data ?? []).filter((entry) => entry.unlocked);
  const inProgress = (achievements.data ?? []).filter((entry) => !entry.unlocked).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Records"
        description="Your bests, recomputed from the matches themselves."
      />

      <FilterBar filter={filter} onChange={update} className="mb-4" showDimensions={false} />

      {records.isLoading && !records.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (records.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="No records yet"
            icon="🏆"
            description="Records appear as soon as there are matches to draw them from."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {records.data!.map((record) => (
            <li key={record.code}>
              <Card className="card-pad h-full">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {record.label}
                </p>
                <p className="mt-1.5 text-stat font-semibold text-ink">{record.value}</p>
                {record.detail ? (
                  <p className="mt-1 text-xs text-ink-secondary">{record.detail}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-3 text-xs">
                  {record.occurredAt ? (
                    <span className="text-ink-muted">{formatShortDate(record.occurredAt)}</span>
                  ) : null}
                  {record.matchId ? (
                    <Link
                      href={`/matches/${record.matchId}`}
                      className="text-accent hover:underline"
                    >
                      View match
                    </Link>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Achievements</h2>

        {achievements.isLoading && !achievements.data ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={`Unlocked (${unlocked.length})`}
                description="Detected automatically whenever a match is recorded."
              />
              {unlocked.length === 0 ? (
                <p className="p-4 text-sm text-ink-secondary sm:p-5">
                  Your first badge arrives with your first match.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:p-5">
                  {unlocked.map((entry) => (
                    <li
                      key={entry.code}
                      className="flex flex-col items-center gap-1 rounded border border-line p-3 text-center"
                    >
                      <span aria-hidden="true" className="text-2xl">
                        {entry.icon}
                      </span>
                      <span className="text-xs font-medium text-ink">{entry.name}</span>
                      <span className="text-[11px] text-ink-muted">
                        {formatShortDate(entry.unlockedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Closest to unlocking" />
              <ul className="divide-y divide-line">
                {inProgress.map((entry) => (
                  <li key={entry.code} className="px-4 py-3 sm:px-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-ink">
                        <span aria-hidden="true" className="mr-1.5">
                          {entry.icon}
                        </span>
                        {entry.name}
                      </span>
                      <span className="tabular shrink-0 text-xs text-ink-secondary">
                        {Math.min(entry.progress, entry.threshold)} / {entry.threshold}
                      </span>
                    </div>
                    <Meter
                      className="mt-1.5"
                      value={entry.progress}
                      max={entry.threshold}
                      label={`${entry.name}: ${entry.percentComplete}% complete`}
                    />
                    <p className="mt-1 text-xs text-ink-muted">{entry.description}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </section>
    </>
  );
}
