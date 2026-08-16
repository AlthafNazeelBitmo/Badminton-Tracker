'use client';

import { useMemo, useRef, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import type { PlayerSummary } from '@badminton/contracts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { initials } from '@/lib/format';
import { Button, Input, Spinner, cx } from './ui';

/**
 * Picks the people in a match.
 *
 * Two paths, because both matter: the people you play with most are one tap away
 * (sorted by how recently you played them), and anyone new is just typed. Typing a name
 * creates the player immediately so the rest of the flow is unchanged — no modal, no
 * detour, no "add a player first".
 */
export function PersonPicker({
  label,
  players,
  selected,
  max,
  exclude = [],
  onChange,
  emptyHint,
}: {
  label: string;
  players: PlayerSummary[];
  selected: string[];
  max: number;
  exclude?: string[];
  onChange: (next: string[]) => void;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState('');
  // Players created here are held locally as well as pushed into the shared cache.
  // Revalidation is asynchronous, so without this the chip for someone you just added
  // renders as "Unknown" until the list refetches.
  const [justCreated, setJustCreated] = useState<PlayerSummary[]>([]);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(
    () => new Map([...players, ...justCreated].map((player) => [player.id, player])),
    [players, justCreated],
  );

  const available = useMemo(() => {
    const blocked = new Set([...selected, ...exclude]);
    const term = query.trim().toLowerCase();
    const seen = new Set<string>();

    return [...players, ...justCreated]
      .filter((player) => {
        if (seen.has(player.id)) return false;
        seen.add(player.id);
        return !player.isSelf && !blocked.has(player.id);
      })
      .filter((player) => (term ? player.name.toLowerCase().includes(term) : true));
  }, [players, justCreated, selected, exclude, query]);

  const exactMatch = available.some(
    (player) => player.name.toLowerCase() === query.trim().toLowerCase(),
  );

  const { run: createPlayer, isPending, error } = useAction(async (name: string) => {
    const created = await api.post<PlayerSummary>('/players', { name, relationship: 'OTHER' });

    setJustCreated((current) => [...current, created]);
    onChange([...selected, created.id]);
    setQuery('');
    inputRef.current?.focus();

    // Refresh every cached player list so the rest of the app sees the new person too.
    void globalMutate((key) => typeof key === 'string' && key.startsWith('/players'));

    return created;
  });

  const select = (playerId: string) => {
    if (selected.length >= max) {
      // At capacity, tapping someone new replaces the last choice rather than being
      // silently ignored — the common case is correcting a mis-tap.
      onChange([...selected.slice(0, max - 1), playerId]);
    } else {
      onChange([...selected, playerId]);
    }
    setQuery('');
  };

  const remove = (playerId: string) => onChange(selected.filter((id) => id !== playerId));

  const full = selected.length >= max;

  // Only the handful of most recent people are shown by default. The list is sorted by
  // recency, so those cover almost every entry — and keeping it short is what stops the
  // score fields from being pushed below the fold on a phone, which is the whole point
  // of this screen.
  const COLLAPSED_SUGGESTIONS = 6;
  const visibleCount = showAll || query.trim() ? available.length : COLLAPSED_SUGGESTIONS;
  const hiddenCount = available.length - visibleCount;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-ink-muted">
          {selected.length} of {max}
        </span>
      </div>

      {selected.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((playerId) => {
            const player = byId.get(playerId);
            return (
              <li key={playerId}>
                <button
                  type="button"
                  onClick={() => remove(playerId)}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accent-soft px-2.5 py-1.5 text-sm text-accent"
                >
                  {player?.name ?? 'Unknown'}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove {player?.name ?? 'player'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!full ? (
        <>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={query}
              placeholder="Search or type a new name"
              aria-label={`Search or add ${label.toLowerCase()}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const first = available[0];
                if (first) select(first.id);
                else if (query.trim().length > 0) void createPlayer(query.trim());
              }}
            />
            {query.trim().length > 0 && !exactMatch ? (
              <Button
                type="button"
                onClick={() => void createPlayer(query.trim())}
                loading={isPending}
              >
                Add
              </Button>
            ) : null}
          </div>

          {available.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {available.slice(0, visibleCount).map((player) => (
                <li key={player.id}>
                  <button
                    type="button"
                    onClick={() => select(player.id)}
                    className={cx(
                      'inline-flex items-center gap-2 rounded-sm border border-line bg-surface-raised py-1.5 pl-1.5 pr-2.5',
                      'text-sm text-ink transition-colors hover:border-accent',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-sunken text-[10px] font-semibold text-ink-secondary"
                    >
                      {initials(player.name)}
                    </span>
                    {player.name}
                    {player.matchesPlayed > 0 ? (
                      <span className="text-xs text-ink-muted">{player.matchesPlayed}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">
              {query.trim()
                ? `No one called "${query.trim()}" yet — press Add to create them.`
                : (emptyHint ?? 'Type a name to add someone.')}
            </p>
          )}

          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 text-xs text-accent hover:underline"
            >
              Show {hiddenCount} more
            </button>
          ) : null}

          {isPending ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
              <Spinner className="h-3 w-3" /> Adding…
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 text-xs text-loss">
              {error.message}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
