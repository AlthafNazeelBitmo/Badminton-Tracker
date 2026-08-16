'use client';

import { useRef } from 'react';
import { gamesRequiredToWin, validateGameScore, type ScoringRules } from '@badminton/contracts';
import { Button, cx } from './ui';

export interface GameInput {
  myScore: string;
  opponentScore: string;
}

/**
 * Score entry.
 *
 * Designed for thumbs on a phone, standing next to a court:
 *  - numeric keypads and generous targets, so no keyboard switching;
 *  - focus advances automatically as each score is filled, so a straight-games win is
 *    four taps and nothing else;
 *  - a third game appears only once the match is actually level, because offering a
 *    decider after a 2-0 invites a mis-entry;
 *  - each game shows whether it is a legal score as it is typed, rather than failing
 *    at save time.
 */
export function ScoreEntry({
  games,
  onChange,
  scoring,
}: {
  games: GameInput[];
  onChange: (games: GameInput[]) => void;
  scoring: ScoringRules;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const needed = gamesRequiredToWin(scoring);
  const completed = games.filter((game) => game.myScore !== '' && game.opponentScore !== '');
  const myGames = completed.filter(
    (game) => Number(game.myScore) > Number(game.opponentScore),
  ).length;
  const theirGames = completed.length - myGames;
  const decided = myGames >= needed || theirGames >= needed;

  const setValue = (index: number, side: keyof GameInput, raw: string) => {
    // Only digits, and never more than the cap allows.
    const digits = raw.replace(/\D/g, '').slice(0, 3);
    if (digits !== '' && Number(digits) > scoring.maxPoints) return;

    const next = games.map((game, position) =>
      position === index ? { ...game, [side]: digits } : game,
    );
    onChange(next);

    // Advance once a score can no longer grow, so two-digit entry is uninterrupted.
    if (digits.length >= 2) {
      const flatIndex = index * 2 + (side === 'myScore' ? 0 : 1);
      inputs.current[flatIndex + 1]?.focus();
    }
  };

  const addGame = () => onChange([...games, { myScore: '', opponentScore: '' }]);
  const removeGame = (index: number) => onChange(games.filter((_, position) => position !== index));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">Scores</span>
        <span className="text-xs text-ink-muted">
          You <span aria-hidden="true">·</span> Them
        </span>
      </div>

      <ol className="space-y-2">
        {games.map((game, index) => {
          const filled = game.myScore !== '' && game.opponentScore !== '';
          const check = filled
            ? validateGameScore(
                { myScore: Number(game.myScore), opponentScore: Number(game.opponentScore) },
                scoring,
              )
            : null;
          const invalid = check !== null && !check.valid;
          const won = filled && Number(game.myScore) > Number(game.opponentScore);

          return (
            <li key={index} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-ink-muted">Game {index + 1}</span>

              <input
                ref={(element) => {
                  inputs.current[index * 2] = element;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={`Game ${index + 1}, your score`}
                aria-invalid={invalid}
                value={game.myScore}
                onChange={(event) => setValue(index, 'myScore', event.target.value)}
                className={cx(
                  'h-14 w-full rounded border bg-surface-raised text-center text-xl font-semibold tabular',
                  invalid ? 'border-loss' : 'border-line focus:border-accent',
                )}
              />

              <span aria-hidden="true" className="text-ink-muted">
                –
              </span>

              <input
                ref={(element) => {
                  inputs.current[index * 2 + 1] = element;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={`Game ${index + 1}, their score`}
                aria-invalid={invalid}
                value={game.opponentScore}
                onChange={(event) => setValue(index, 'opponentScore', event.target.value)}
                className={cx(
                  'h-14 w-full rounded border bg-surface-raised text-center text-xl font-semibold tabular',
                  invalid ? 'border-loss' : 'border-line focus:border-accent',
                )}
              />

              <span className="w-6 shrink-0 text-center text-sm">
                {filled && !invalid ? (
                  <span className={won ? 'text-win' : 'text-loss'} title={won ? 'Won' : 'Lost'}>
                    <span aria-hidden="true">{won ? 'W' : 'L'}</span>
                    <span className="sr-only">{won ? 'Game won' : 'Game lost'}</span>
                  </span>
                ) : null}
              </span>

              {games.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeGame(index)}
                  aria-label={`Remove game ${index + 1}`}
                  className="w-6 shrink-0 text-ink-muted hover:text-loss"
                >
                  <span aria-hidden="true">×</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>

      {games.length < scoring.bestOf && !decided ? (
        <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={addGame}>
          + Add game {games.length + 1}
        </Button>
      ) : null}

      {completed.length > 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">
          {decided ? (
            <>
              <strong className={myGames > theirGames ? 'text-win' : 'text-loss'}>
                {myGames > theirGames ? 'Win' : 'Loss'}
              </strong>{' '}
              {myGames}–{theirGames} in games
            </>
          ) : (
            <>
              {myGames}–{theirGames} in games, first to {needed}
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
