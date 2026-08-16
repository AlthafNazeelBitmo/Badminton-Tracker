'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  DISCIPLINES,
  DISCIPLINE_LABELS,
  MATCH_RESULTS,
  type ListMatchesQuery,
  type MatchSummary,
} from '@badminton/contracts';
import { buildQuery } from '@/lib/api';
import { useMatches } from '@/lib/hooks';
import { duration, formatDate, joinNames, scoreline, signed } from '@/lib/format';
import { Button, Card, EmptyState, ErrorState, PageHeader, ResultBadge, Skeleton, cx } from '@/components/ui';

type Sort = ListMatchesQuery['sort'];

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'NEWEST', label: 'Newest' },
  { value: 'OLDEST', label: 'Oldest' },
  { value: 'BIGGEST_WIN', label: 'Biggest win' },
  { value: 'CLOSEST', label: 'Narrowest margin' },
  { value: 'LONGEST', label: 'Longest' },
  { value: 'HIGHEST_SCORING', label: 'Highest scoring' },
];

/**
 * Match history.
 *
 * Grouped by day, because that is how the matches were played and how people remember
 * them ("that Saturday I lost three in a row"). Search covers opponent names and notes,
 * which makes the notes field a searchable journal rather than a write-only box.
 */
export default function MatchesPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>('NEWEST');
  const [result, setResult] = useState<string>('');
  const [discipline, setDiscipline] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = buildQuery({
    page,
    pageSize: 25,
    sort,
    result: result || undefined,
    discipline: discipline || undefined,
    search: debounced || undefined,
  });

  const { data, error, isLoading, mutate } = useMatches(query);

  const grouped = useMemo(() => groupByDay(data?.items ?? []), [data]);

  if (error) return <ErrorState error={error as Error} onRetry={() => void mutate()} />;

  return (
    <>
      <PageHeader
        title="Matches"
        description={
          data ? `${data.meta.totalItems} match${data.meta.totalItems === 1 ? '' : 'es'} recorded` : undefined
        }
        action={
          <Link
            href="/record"
            className="inline-flex h-11 items-center rounded bg-accent px-4 text-sm font-medium text-accent-ink"
          >
            Record
          </Link>
        }
      />

      <Card className="mb-4 p-3">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search opponents or notes"
            aria-label="Search matches"
            className="h-10 w-full rounded border border-line bg-surface-raised px-3 text-sm"
          />
          <select
            value={result}
            onChange={(event) => {
              setResult(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by result"
            className="h-10 rounded border border-line bg-surface-raised px-2 text-sm"
          >
            <option value="">All results</option>
            {MATCH_RESULTS.map((value) => (
              <option key={value} value={value}>
                {value === 'WIN' ? 'Wins' : value === 'LOSS' ? 'Losses' : 'Draws'}
              </option>
            ))}
          </select>
          <select
            value={discipline}
            onChange={(event) => {
              setDiscipline(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by discipline"
            className="h-10 rounded border border-line bg-surface-raised px-2 text-sm"
          >
            <option value="">All formats</option>
            {DISCIPLINES.map((value) => (
              <option key={value} value={value}>
                {DISCIPLINE_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as Sort);
              setPage(1);
            }}
            aria-label="Sort matches"
            className="h-10 rounded border border-line bg-surface-raised px-2 text-sm"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {isLoading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            title="No matches found"
            description={
              debounced || result || discipline
                ? 'Nothing matches those filters. Try widening them.'
                : 'Record your first match and it will appear here.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([day, matches]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {formatDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h2>
              <Card className="divide-y divide-line">
                {matches.map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      {data && data.meta.totalPages > 1 ? (
        <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-3">
          <Button
            size="sm"
            disabled={!data.meta.hasPreviousPage}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-ink-muted">
            Page {data.meta.page} of {data.meta.totalPages}
          </span>
          <Button
            size="sm"
            disabled={!data.meta.hasNextPage}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </>
  );
}

function MatchRow({ match }: { match: MatchSummary }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken sm:px-5"
    >
      <ResultBadge result={match.derived.result} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {match.partners.length > 0 ? (
            <>
              <span className="text-ink-secondary">with </span>
              {joinNames(match.partners.map((person) => person.name))}
              <span className="text-ink-secondary"> v </span>
            </>
          ) : null}
          {joinNames(match.opponents.map((person) => person.name))}
        </p>
        <p className="tabular mt-0.5 truncate text-xs text-ink-secondary">
          {scoreline(match.games)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          <span>{DISCIPLINE_LABELS[match.discipline]}</span>
          {match.venue ? <span>· {match.venue.name}</span> : null}
          {match.durationSeconds ? <span>· {duration(match.durationSeconds)}</span> : null}
          {match.derived.isComeback ? <span className="text-win">· comeback</span> : null}
          {match.derived.isCollapse ? <span className="text-loss">· collapse</span> : null}
        </p>
      </div>

      <span
        className={cx(
          'tabular shrink-0 text-sm font-medium',
          match.derived.pointDifferential > 0
            ? 'text-win'
            : match.derived.pointDifferential < 0
              ? 'text-loss'
              : 'text-ink-muted',
        )}
      >
        {signed(match.derived.pointDifferential)}
      </span>
    </Link>
  );
}

/** Groups matches by calendar day, preserving the order the API returned. */
function groupByDay(matches: MatchSummary[]): Array<[string, MatchSummary[]]> {
  const groups = new Map<string, MatchSummary[]>();
  for (const match of matches) {
    const day = match.playedAt.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) bucket.push(match);
    else groups.set(day, [match]);
  }
  return [...groups.entries()];
}
