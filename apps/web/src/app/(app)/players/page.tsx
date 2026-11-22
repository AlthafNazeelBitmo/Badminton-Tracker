'use client';

import { Contact, ListOrdered, Merge, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  DOMINANT_HANDS,
  PLAYER_RELATIONSHIPS,
  PLAYING_LEVELS,
  type PlayerSummary,
} from '@badminton/contracts';
import { api } from '@/lib/api';
import { invalidateMatchData, useAction, usePlayers } from '@/lib/hooks';
import { formatShortDate, titleCase } from '@/lib/format';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Spinner,
} from '@/components/ui';

/**
 * The address book.
 *
 * Quick entry creates players by name, which inevitably produces the occasional
 * duplicate ("Jon" and "John"). Merging is therefore first-class here rather than a
 * support request: it moves every appearance across and keeps the history intact.
 */
export default function PlayersPage() {
  const { data, error, isLoading, mutate } = usePlayers('?pageSize=100&sort=MOST_PLAYED');
  const [adding, setAdding] = useState(false);
  const [merging, setMerging] = useState<PlayerSummary | null>(null);

  if (error) return <ErrorState error={error as Error} onRetry={() => void mutate()} />;

  const players = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Players"
        description="Everyone you have played with or against."
        action={
          <Button variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding((open) => !open)}>
            {adding ? 'Cancel' : 'Add player'}
          </Button>
        }
      />

      {adding ? (
        <PlayerForm
          onSaved={() => {
            setAdding(false);
            void mutate();
          }}
        />
      ) : null}

      {merging ? (
        <MergePanel
          source={merging}
          players={players}
          onDone={() => {
            setMerging(null);
            invalidateMatchData();
            void mutate();
          }}
          onCancel={() => setMerging(null)}
        />
      ) : null}

      {isLoading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : players.length === 0 ? (
        <Card>
          <EmptyState
            title="No players yet"
            icon={<Contact />}
            description="Players are created automatically as you record matches — just type a name."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              onMerge={() => setMerging(player)}
              onChanged={() => void mutate()}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function PlayerRow({
  player,
  onMerge,
  onChanged,
}: {
  player: PlayerSummary;
  onMerge: () => void;
  onChanged: () => void;
}) {
  const {
    run: remove,
    isPending,
    error,
  } = useAction(async () => {
    await api.delete(`/players/${player.id}`);
    onChanged();
  });

  return (
    <div className="group flex flex-wrap items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-ink/[0.02] sm:px-5">
      <Avatar name={player.name} size="md" />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {player.name}
          {player.relationship !== 'OTHER' ? <Badge>{titleCase(player.relationship)}</Badge> : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-muted">
          <span className="tabular">
            {player.matchesPlayed} match{player.matchesPlayed === 1 ? '' : 'es'}
          </span>
          {player.lastPlayedAt ? ` · last played ${formatShortDate(player.lastPlayedAt)}` : ''}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-loss">
            {error.message}
          </p>
        ) : null}
      </div>

      {player.matchesPlayed > 0 ? (
        <div className="hidden text-right sm:block">
          <p className="eyebrow">Rating</p>
          <p className="tabular text-sm font-semibold text-ink">{Math.round(player.rating)}</p>
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-0.5">
        {player.matchesPlayed > 0 ? (
          <Link
            href={`/matches?opponentId=${player.id}`}
            title="View matches"
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
          >
            <ListOrdered className="size-4" aria-hidden="true" />
            <span className="sr-only">Matches with {player.name}</span>
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onMerge}
          title="Merge into another player"
          className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          <Merge className="size-4" aria-hidden="true" />
          <span className="sr-only">Merge {player.name}</span>
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={isPending}
          title="Delete"
          className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-loss-soft hover:text-loss disabled:opacity-50"
        >
          {isPending ? (
            <Spinner className="size-3.5" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
          <span className="sr-only">Delete {player.name}</span>
        </button>
      </div>
    </div>
  );
}

function MergePanel({
  source,
  players,
  onDone,
  onCancel,
}: {
  source: PlayerSummary;
  players: PlayerSummary[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [targetId, setTargetId] = useState('');

  const { run, isPending, error } = useAction(async () => {
    await api.post(`/players/${source.id}/merge/${targetId}`);
    onDone();
  });

  const candidates = players.filter((player) => player.id !== source.id && !player.isSelf);

  return (
    <Card className="card-pad mb-4 border-accent-text/40">
      <h2 className="text-sm font-semibold text-ink">Merge {source.name} into another player</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Every one of {source.name}&rsquo;s {source.matchesPlayed} appearances moves to the player
        you choose, and {source.name} is removed. Your matches and statistics are preserved.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Keep this player" htmlFor="merge-target">
          <Select
            id="merge-target"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            <option value="">Choose…</option>
            {candidates.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} ({player.matchesPlayed})
              </option>
            ))}
          </Select>
        </Field>

        <Button
          variant="primary"
          onClick={() => void run()}
          loading={isPending}
          disabled={!targetId}
        >
          Merge
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-loss">
          {error.message}
        </p>
      ) : null}
    </Card>
  );
}

function PlayerForm({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
    name: '',
    relationship: 'OTHER',
    playingLevel: '',
    dominantHand: 'UNKNOWN',
  });

  const { run, isPending, error } = useAction(async () => {
    await api.post('/players', {
      name: form.name.trim(),
      relationship: form.relationship,
      playingLevel: form.playingLevel || null,
      dominantHand: form.dominantHand,
    });
    onSaved();
  });

  return (
    <Card className="card-pad mb-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Field label="Name" htmlFor="player-name" required>
          <Input
            id="player-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>

        <Field label="Relationship" htmlFor="player-relationship">
          <Select
            id="player-relationship"
            value={form.relationship}
            onChange={(event) => setForm({ ...form, relationship: event.target.value })}
          >
            {PLAYER_RELATIONSHIPS.filter((value) => value !== 'SELF').map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Level" htmlFor="player-level">
          <Select
            id="player-level"
            value={form.playingLevel}
            onChange={(event) => setForm({ ...form, playingLevel: event.target.value })}
          >
            <option value="">Unknown</option>
            {PLAYING_LEVELS.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Hand" htmlFor="player-hand">
          <Select
            id="player-hand"
            value={form.dominantHand}
            onChange={(event) => setForm({ ...form, dominantHand: event.target.value })}
          >
            {DOMINANT_HANDS.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" loading={isPending} disabled={!form.name.trim()}>
            Add player
          </Button>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-loss">
              {error.message}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
