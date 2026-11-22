'use client';

import Link from 'next/link';
import { ChevronRight, Clock3, MapPin, Plus, Search } from 'lucide-react';
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
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  ResultBadge,
  Skeleton,
  buttonClass,
  controlClasses,
  cx,
  selectClasses,
} from '@/components/ui';

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
          data
            ? `${data.meta.totalItems} match${data.meta.totalItems === 1 ? '' : 'es'} recorded`
            : undefined
        }
        action={
          <Link href="/record" className={buttonClass('primary')}>
            <Plus strokeWidth={2.5} />
            Record match
          </Link>
        }
      />

      <div className="mb-6">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search opponents or notes"
              aria-label="Search matches"
              className={cx(controlClasses, 'h-10 pl-9')}
            />
          </div>
          <select
            value={result}
            onChange={(event) => {
              setResult(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by result"
            className={cx(selectClasses, 'h-10')}
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
            className={cx(selectClasses, 'h-10')}
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
            className={cx(selectClasses, 'h-10')}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

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
              <h2 className="eyebrow mb-2.5 px-1">
                {formatDate(day, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </h2>
              <Card className="divide-y divide-line overflow-hidden">
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
  const opponents = match.opponents.map((person) => person.name);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ink/[0.025] sm:px-5"
    >
      <ResultBadge result={match.derived.result} />

      <div className="hidden -space-x-2 sm:flex">
        {opponents.slice(0, 2).map((name) => (
          <Avatar key={name} name={name} size="md" className="ring-2 ring-surface-raised" />
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {joinNames(opponents)}
          {match.partners.length > 0 ? (
            <span className="font-normal text-ink-muted">
              {' '}
              · with {joinNames(match.partners.map((person) => person.name))}
            </span>
          ) : null}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 font-medium text-ink-secondary">
            {DISCIPLINE_LABELS[match.discipline]}
          </span>
          {match.venue ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden="true" />
              {match.venue.name}
            </span>
          ) : null}
          {match.durationSeconds ? (
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" aria-hidden="true" />
              {duration(match.durationSeconds)}
            </span>
          ) : null}
          {match.derived.isComeback ? <Badge tone="win">Comeback</Badge> : null}
          {match.derived.isCollapse ? <Badge tone="loss">Collapse</Badge> : null}
        </p>
      </div>

      {/* The chips are for the eye; the scoreline after them is the text, read once. */}
      <ol className="hidden items-center gap-1 md:flex" aria-hidden="true">
        {match.games.map((game, index) => {
          const won = game.myScore > game.opponentScore;
          return (
            <li
              key={index}
              className={cx(
                'tabular rounded-md px-2 py-1 font-mono text-xs',
                won ? 'bg-win-soft font-semibold text-win' : 'bg-surface-sunken text-ink-secondary',
              )}
            >
              {game.myScore}–{game.opponentScore}
            </li>
          );
        })}
      </ol>
      <span className="tabular font-mono text-xs text-ink-secondary md:sr-only">
        {scoreline(match.games)}
      </span>

      <span
        className={cx(
          'tabular w-10 shrink-0 text-right text-sm font-semibold',
          match.derived.pointDifferential > 0
            ? 'text-win'
            : match.derived.pointDifferential < 0
              ? 'text-loss'
              : 'text-ink-muted',
        )}
      >
        {signed(match.derived.pointDifferential)}
      </span>
      <ChevronRight
        className="hidden size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 sm:block"
        aria-hidden="true"
      />
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
