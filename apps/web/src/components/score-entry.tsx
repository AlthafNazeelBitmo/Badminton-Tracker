'use client';

import { Fragment, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { gamesRequiredToWin, validateGameScore, type ScoringRules } from '@badminton/contracts';
import { Button, ResultBadge, cx } from './ui';

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

  const tile = (invalid: boolean, leading: boolean) =>
    cx(
      'tabular h-16 w-full rounded-xl border bg-surface-raised text-center text-[32px] font-semibold tracking-[-0.03em] text-ink shadow-card',
      'transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-muted/40',
      'focus:border-accent-text/60 focus:shadow-ring focus:outline-none focus-visible:outline-none',
      invalid
        ? 'border-loss bg-loss-soft'
        : leading
          ? 'border-win/40 bg-win-soft'
          : 'border-line hover:border-line-strong',
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-ink">Scores</span>
        <span className="text-xs text-ink-muted">
          Best of {scoring.bestOf} to {scoring.pointsToWin}
        </span>
      </div>

      <div className="grid grid-cols-[3.5rem_minmax(0,7rem)_minmax(0,7rem)_auto] items-center gap-x-2 gap-y-2.5 sm:gap-x-3">
        <span />
        <span className="eyebrow text-center">You</span>
        <span className="eyebrow text-center">Them</span>
        <span />

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
            <Fragment key={index}>
              <span className="text-xs font-medium text-ink-muted">Game {index + 1}</span>

              <input
                ref={(element) => {
                  inputs.current[index * 2] = element;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                aria-label={`Game ${index + 1}, your score`}
                aria-invalid={invalid}
                value={game.myScore}
                onChange={(event) => setValue(index, 'myScore', event.target.value)}
                className={tile(invalid, filled && !invalid && won)}
              />

              <input
                ref={(element) => {
                  inputs.current[index * 2 + 1] = element;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                aria-label={`Game ${index + 1}, their score`}
                aria-invalid={invalid}
                value={game.opponentScore}
                onChange={(event) => setValue(index, 'opponentScore', event.target.value)}
                className={tile(invalid, filled && !invalid && !won)}
              />

              <span className="flex items-center gap-1">
                {filled && !invalid ? (
                  <ResultBadge result={won ? 'WIN' : 'LOSS'} size="sm" />
                ) : invalid ? (
                  <span className="text-[11px] font-medium text-loss">Check</span>
                ) : (
                  <span className="size-6" />
                )}
                {games.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeGame(index)}
                    aria-label={`Remove game ${index + 1}`}
                    className="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-loss-soft hover:text-loss"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </Fragment>
          );
        })}
      </div>

      {games.length < scoring.bestOf && !decided ? (
        <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={addGame}>
          <Plus /> Add game {games.length + 1}
        </Button>
      ) : null}

      {completed.length > 0 ? (
        <div
          aria-live="polite"
          className={cx(
            'mt-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm',
            decided
              ? myGames > theirGames
                ? 'bg-win-soft text-win'
                : 'bg-loss-soft text-loss'
              : 'bg-surface-sunken text-ink-secondary',
          )}
        >
          <span className="font-semibold">
            {decided ? (myGames > theirGames ? 'Win' : 'Loss') : 'In progress'}
          </span>{' '}
          <span className="tabular font-medium">
            {myGames}–{theirGames} in games{decided ? '' : `, first to ${needed}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
