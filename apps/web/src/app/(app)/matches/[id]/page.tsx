'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { DISCIPLINE_LABELS, PERFORMANCE_TAG_LABELS, SESSION_TYPE_LABELS, describeRules } from '@badminton/contracts';
import { api } from '@/lib/api';
import { invalidateMatchData, useAction, useMatch } from '@/lib/hooks';
import { duration, formatDate, formatDateTime, joinNames, signed } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  ResultBadge,
  Skeleton,
  cx,
} from '@/components/ui';

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: match, error, isLoading, mutate } = useMatch(params.id ?? null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { run: remove, isPending: deleting } = useAction(async () => {
    await api.delete(`/matches/${params.id}`);
    invalidateMatchData();
    router.replace('/matches');
  });

  if (error) return <ErrorState error={error as Error} onRetry={() => void mutate()} />;

  if (isLoading || !match) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const { derived } = match;

  return (
    <>
      <Link href="/matches" className="mb-3 inline-block text-sm text-accent hover:underline">
        ← All matches
      </Link>

      <PageHeader
        title={`${derived.result === 'WIN' ? 'Win' : derived.result === 'LOSS' ? 'Loss' : 'Draw'} v ${joinNames(
          match.opponents.map((person) => person.name),
        )}`}
        description={`${formatDateTime(match.playedAt)} · ${DISCIPLINE_LABELS[match.discipline]}${
          match.venue ? ` · ${match.venue.name}` : ''
        }`}
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          {/* Scoreline */}
          <Card>
            <CardHeader
              title="Scoreline"
              description={describeRules(match.scoring)}
              action={<ResultBadge result={derived.result} />}
            />
            <div className="p-4 sm:p-5">
              <table className="w-full text-sm">
                <caption className="sr-only">Game by game scores</caption>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="pb-2 font-medium">
                      Game
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      You
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      Them
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      Margin
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {match.games.map((game) => (
                    <tr key={game.id}>
                      <th scope="row" className="py-2.5 text-left font-normal text-ink-secondary">
                        Game {game.gameNumber}
                      </th>
                      <td
                        className={cx(
                          'py-2.5 text-right text-lg font-semibold',
                          game.result === 'WIN' ? 'text-win' : 'text-ink',
                        )}
                      >
                        {game.myScore}
                      </td>
                      <td
                        className={cx(
                          'py-2.5 text-right text-lg font-semibold',
                          game.result === 'LOSS' ? 'text-loss' : 'text-ink',
                        )}
                      >
                        {game.opponentScore}
                      </td>
                      <td className="py-2.5 text-right text-ink-secondary">{game.margin}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong font-medium">
                    <th scope="row" className="pt-2.5 text-left">
                      Total
                    </th>
                    <td className="pt-2.5 text-right">{derived.pointsScored}</td>
                    <td className="pt-2.5 text-right">{derived.pointsConceded}</td>
                    <td
                      className={cx(
                        'pt-2.5 text-right',
                        derived.pointDifferential > 0
                          ? 'text-win'
                          : derived.pointDifferential < 0
                            ? 'text-loss'
                            : '',
                      )}
                    >
                      {signed(derived.pointDifferential)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Insights */}
          <Card>
            <CardHeader
              title="About this match"
              description="Facts drawn from this scoreline only."
            />
            <ul className="space-y-2 p-4 text-sm text-ink-secondary sm:p-5">
              {match.insights.map((insight, index) => (
                <li key={index} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-muted">
                    •
                  </span>
                  {insight}
                </li>
              ))}
            </ul>
          </Card>

          {match.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap p-4 text-sm text-ink sm:p-5">{match.notes}</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {/* Who played */}
          <Card>
            <CardHeader title="Who played" />
            <div className="space-y-3 p-4 sm:p-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Your side</p>
                <p className="mt-1 text-sm text-ink">
                  You
                  {match.partners.length > 0
                    ? ` & ${joinNames(match.partners.map((person) => person.name))}`
                    : ''}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Opposition</p>
                <ul className="mt-1 space-y-1">
                  {match.opponents.map((person) => (
                    <li key={person.playerId}>
                      <Link
                        href={`/opponents?player=${person.playerId}`}
                        className="text-sm text-accent hover:underline"
                      >
                        {person.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          {/* Derived facts */}
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-line text-sm">
              <Row label="Session">
                <Link href={`/calendar?date=${match.session.date}`} className="text-accent hover:underline">
                  {formatDate(match.session.date)} · {SESSION_TYPE_LABELS[match.session.sessionType]}
                </Link>
              </Row>
              <Row label="Match number">#{match.orderInSession} of the session</Row>
              <Row label="Duration">{duration(match.durationSeconds)}</Row>
              <Row label="Games">
                {derived.gamesWon}–{derived.gamesLost}
              </Row>
              <Row label="Average per game">{derived.averagePointsPerGame.toFixed(1)} points</Row>
              {match.difficulty ? <Row label="How hard it felt">{match.difficulty} / 5</Row> : null}
              {match.energyLevel ? <Row label="Energy">{match.energyLevel} / 5</Row> : null}
              {match.confidence ? <Row label="Confidence">{match.confidence} / 5</Row> : null}
              {match.ratingChange ? (
                <Row label="Rating">
                  <span
                    className={match.ratingChange.delta >= 0 ? 'text-win' : 'text-loss'}
                  >
                    {match.ratingChange.before.toFixed(0)} → {match.ratingChange.after.toFixed(0)} (
                    {signed(match.ratingChange.delta, 1)})
                  </span>
                </Row>
              ) : null}
            </dl>
          </Card>

          {match.tags.length > 0 ? (
            <Card>
              <CardHeader title="Tags" />
              <div className="flex flex-wrap gap-1.5 p-4 sm:p-5">
                {match.tags.map((tag) => (
                  <Badge key={tag}>{PERFORMANCE_TAG_LABELS[tag]}</Badge>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="card-pad">
            {confirmingDelete ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  Delete this match? Your statistics, records and rating are recomputed from
                  what remains, so this changes them.
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => void remove()} loading={deleting}>
                    Delete match
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" className="w-full" onClick={() => setConfirmingDelete(true)}>
                Delete match
              </Button>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 sm:px-5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
