'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronDown, CircleCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SCORING_RULES,
  PERFORMANCE_TAGS,
  PERFORMANCE_TAG_LABELS,
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  describeRules,
  validateMatchGames,
  type Discipline,
  type PerformanceTag,
  type ScoringRules,
  type SessionType,
} from '@badminton/contracts';
import { api } from '@/lib/api';
import { invalidateMatchData, useAction, usePlayers, useVenues } from '@/lib/hooks';
import { Button, Card, Field, Input, PageHeader, Select, Textarea, cx } from '@/components/ui';
import { PersonPicker } from '@/components/person-picker';
import { ScoreEntry } from '@/components/score-entry';

const DISCIPLINE_OPTIONS: Array<{ value: Discipline; label: string; sides: string }> = [
  { value: 'SINGLES', label: 'Singles', sides: '1 v 1' },
  { value: 'DOUBLES', label: 'Doubles', sides: '2 v 2' },
  { value: 'MIXED_DOUBLES', label: 'Mixed', sides: '2 v 2' },
];

function todayISO(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Quick match entry.
 *
 * The whole screen is built around one number: the time between finishing a match and
 * having it recorded. Everything needed for a valid match — discipline, opponents,
 * scores — is on one screen with no navigation; everything optional is collapsed behind
 * a disclosure. Recent opponents and partners are one tap, and a name that does not
 * exist yet is simply typed. If this is slower than a spreadsheet, the app has failed.
 */
export default function RecordMatchPage() {
  const router = useRouter();
  const { data: playersPage } = usePlayers('?pageSize=100&sort=RECENT');
  const { data: venuesPage } = useVenues('?pageSize=50&sort=RECENT');

  const players = useMemo(() => playersPage?.items ?? [], [playersPage]);
  const venues = useMemo(() => venuesPage?.items ?? [], [venuesPage]);

  const [discipline, setDiscipline] = useState<Discipline>('DOUBLES');
  const [date, setDate] = useState(todayISO());
  const [venueId, setVenueId] = useState<string>('');
  const [sessionType, setSessionType] = useState<SessionType>('CASUAL');
  const [partners, setPartners] = useState<string[]>([]);
  const [opponents, setOpponents] = useState<string[]>([]);
  const [games, setGames] = useState<Array<{ myScore: string; opponentScore: string }>>([
    { myScore: '', opponentScore: '' },
    { myScore: '', opponentScore: '' },
  ]);

  const [showOptional, setShowOptional] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [energyLevel, setEnergyLevel] = useState('');
  const [confidence, setConfidence] = useState('');
  const [tags, setTags] = useState<PerformanceTag[]>([]);
  const [notes, setNotes] = useState('');
  const [scoring] = useState<ScoringRules>({ ...DEFAULT_SCORING_RULES });
  const [saved, setSaved] = useState<string | null>(null);

  const partnersNeeded = discipline === 'SINGLES' ? 0 : 1;
  const opponentsNeeded = discipline === 'SINGLES' ? 1 : 2;

  // Trim the selections when switching from doubles to singles so the form never sits
  // in a state the API would reject.
  useEffect(() => {
    setPartners((current) => current.slice(0, partnersNeeded));
    setOpponents((current) => current.slice(0, opponentsNeeded));
  }, [partnersNeeded, opponentsNeeded]);

  const parsedGames = useMemo(
    () =>
      games
        .filter((game) => game.myScore !== '' && game.opponentScore !== '')
        .map((game) => ({
          myScore: Number(game.myScore),
          opponentScore: Number(game.opponentScore),
        })),
    [games],
  );

  // Live validation against the very same rules the server enforces, so a bad scoreline
  // is caught before the save rather than after it.
  const validation = useMemo(
    () => (parsedGames.length === 0 ? null : validateMatchGames(parsedGames, scoring)),
    [parsedGames, scoring],
  );

  const canSave =
    opponents.length === opponentsNeeded &&
    partners.length === partnersNeeded &&
    parsedGames.length > 0 &&
    validation?.valid === true;

  const { run, isPending, error } = useAction(async () => {
    const venue = venues.find((candidate) => candidate.id === venueId);

    const created = await api.post<{ id: string; derived: { result: string } }>('/matches', {
      discipline,
      session: {
        date,
        sessionType,
        ...(venue ? { venueId: venue.id } : {}),
      },
      partners: partners.map((id) => ({ playerId: id })),
      opponents: opponents.map((id) => ({ playerId: id })),
      games: parsedGames,
      scoring,
      durationSeconds: durationMinutes ? Number(durationMinutes) * 60 : null,
      difficulty: difficulty ? Number(difficulty) : null,
      energyLevel: energyLevel ? Number(energyLevel) : null,
      confidence: confidence ? Number(confidence) : null,
      tags,
      notes: notes.trim() || null,
    });

    invalidateMatchData();
    setSaved(created.derived.result);

    // Reset only the per-match fields. Date, venue, discipline and the people involved
    // persist, because the next match is almost always the same evening with the same
    // group — that is what makes recording five matches take seconds rather than minutes.
    setGames([
      { myScore: '', opponentScore: '' },
      { myScore: '', opponentScore: '' },
    ]);
    setTags([]);
    setNotes('');
    setDurationMinutes('');

    return created;
  });

  const savedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Quick entry"
        title="Record a match"
        description="Pick who played, tap in the scores, save. Everything else is optional."
      />

      {saved ? (
        <div
          ref={savedRef}
          tabIndex={-1}
          role="status"
          className="animate-in mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-win/25 bg-win-soft px-4 py-3"
        >
          <p className="flex items-center gap-2 text-sm text-ink">
            <CircleCheck className="size-4 text-win" aria-hidden="true" />
            <strong>Saved.</strong> Recorded as a {saved.toLowerCase()}. Ready for the next one.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => router.push('/matches')}>
              View matches
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSaved(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
        noValidate
      >
        {/* Step 1 — discipline */}
        <Card className="card-pad">
          <fieldset>
            <legend className="mb-3 flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink">
              <StepNumber n={1} /> Format
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {DISCIPLINE_OPTIONS.map((option) => {
                const active = discipline === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDiscipline(option.value)}
                    className={cx(
                      'flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-medium transition-all duration-150',
                      active
                        ? 'border-ink bg-ink text-[var(--surface-2)] shadow-lift'
                        : 'border-line bg-surface-raised text-ink-secondary shadow-card hover:border-line-strong hover:text-ink',
                    )}
                  >
                    {option.label}
                    <span className={cx('text-xs', active ? 'opacity-60' : 'text-ink-muted')}>
                      {option.sides}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </Card>

        {/* Step 2 — who played */}
        <Card className="card-pad space-y-5">
          <p className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink">
            <StepNumber n={2} /> Who played
          </p>
          {partnersNeeded > 0 ? (
            <PersonPicker
              label="Your partner"
              players={players}
              selected={partners}
              max={partnersNeeded}
              exclude={opponents}
              onChange={setPartners}
              emptyHint="Tap a recent partner, or type a new name."
            />
          ) : null}

          <PersonPicker
            label={opponentsNeeded === 1 ? 'Opponent' : 'Opponents'}
            players={players}
            selected={opponents}
            max={opponentsNeeded}
            exclude={partners}
            onChange={setOpponents}
            emptyHint="Tap a recent opponent, or type a new name."
          />
        </Card>

        {/* Step 3 — scores */}
        <Card className="card-pad">
          <p className="mb-4 flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink">
            <StepNumber n={3} /> Result
          </p>
          <ScoreEntry games={games} onChange={setGames} scoring={scoring} />

          {validation && !validation.valid ? (
            <ul role="alert" className="mt-3 space-y-1 text-sm text-loss">
              {validation.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  {issue.gameIndex === undefined ? '' : `Game ${issue.gameIndex + 1}: `}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 text-xs text-ink-muted">
            Playing {describeRules(scoring)}. Deuce and 30-29 finishes are accepted.
          </p>
        </Card>

        {/* Step 4 — context, collapsed by default */}
        <Card>
          <button
            type="button"
            onClick={() => setShowOptional((open) => !open)}
            aria-expanded={showOptional}
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left text-sm font-semibold tracking-tight text-ink sm:px-5"
          >
            <span className="flex items-center gap-2.5">
              <StepNumber n={4} muted />
              When and where, and how it felt
              <span className="font-normal text-ink-muted">· optional</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cx(
                'size-4 text-ink-muted transition-transform duration-200',
                showOptional && 'rotate-180',
              )}
            />
          </button>

          {showOptional ? (
            <div className="space-y-4 border-t border-line px-4 py-4 sm:px-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Date" htmlFor="date">
                  <Input
                    id="date"
                    type="date"
                    value={date}
                    max={todayISO()}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </Field>

                <Field label="Venue" htmlFor="venue">
                  <Select
                    id="venue"
                    value={venueId}
                    onChange={(event) => setVenueId(event.target.value)}
                  >
                    <option value="">Not specified</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Session type" htmlFor="sessionType">
                  <Select
                    id="sessionType"
                    value={sessionType}
                    onChange={(event) => setSessionType(event.target.value as SessionType)}
                  >
                    {SESSION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {SESSION_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Duration (min)" htmlFor="duration">
                  <Input
                    id="duration"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={720}
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </Field>

                <RatingSelect
                  id="difficulty"
                  label="How hard (1–5)"
                  value={difficulty}
                  onChange={setDifficulty}
                />
                <RatingSelect
                  id="energy"
                  label="Energy (1–5)"
                  value={energyLevel}
                  onChange={setEnergyLevel}
                />
                <RatingSelect
                  id="confidence"
                  label="Confidence (1–5)"
                  value={confidence}
                  onChange={setConfidence}
                />
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink">Tags</legend>
                <div className="flex flex-wrap gap-1.5">
                  {PERFORMANCE_TAGS.map((tag) => {
                    const active = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setTags((current) =>
                            active ? current.filter((value) => value !== tag) : [...current, tag],
                          )
                        }
                        className={cx(
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'border-accent-text/40 bg-accent-soft text-accent-text'
                            : 'border-line text-ink-secondary hover:border-line-strong',
                        )}
                      >
                        {PERFORMANCE_TAG_LABELS[tag]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Tags are optional. Later they show which themes tend to accompany wins and losses
                  — an association, not a cause.
                </p>
              </fieldset>

              <Field label="Notes" htmlFor="notes">
                <Textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  maxLength={4000}
                  placeholder="Started badly, switched to flat drives and it turned around."
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </Card>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-loss/30 bg-loss-soft px-4 py-3 text-sm text-loss"
          >
            <p>{error.message}</p>
            {error.details?.length ? (
              <ul className="mt-1 list-inside list-disc">
                {error.details.map((detail, index) => (
                  <li key={index}>{detail.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* Sticky on mobile: the save button is always in reach without scrolling. */}
        <div className="sticky bottom-nav z-20 -mx-4 border-t border-line bg-surface-raised/90 px-4 py-3 backdrop-blur-xl lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full lg:w-auto"
            loading={isPending}
            disabled={!canSave}
          >
            <Check strokeWidth={2.5} /> Save match
          </Button>
          {!canSave ? (
            <p className="mt-2 text-xs text-ink-muted lg:hidden">
              {opponents.length !== opponentsNeeded
                ? `Choose ${opponentsNeeded} opponent${opponentsNeeded === 1 ? '' : 's'}.`
                : partners.length !== partnersNeeded
                  ? 'Choose your partner.'
                  : 'Enter the scores.'}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function RatingSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((rating) => (
          <option key={rating} value={rating}>
            {rating}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The step marker on each section of the form: the order is the fastest path. */
function StepNumber({ n, muted }: { n: number; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
        muted ? 'bg-surface-sunken text-ink-muted' : 'bg-accent text-accent-ink',
      )}
    >
      {n}
    </span>
  );
}
