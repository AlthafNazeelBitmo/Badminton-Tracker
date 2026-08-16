'use client';

import useSWR from 'swr';
import { useEffect, useState } from 'react';
import {
  DISCIPLINES,
  DISCIPLINE_LABELS,
  DOMINANT_HANDS,
  PLAYING_LEVELS,
  PLAYING_STYLES,
  SCORING_PRESETS,
  describeRules,
  type ScoringRules,
} from '@badminton/contracts';
import { api, downloadFile } from '@/lib/api';
import { useAction, useSession } from '@/lib/hooks';
import { browserTimeZone, titleCase } from '@/lib/format';
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';

interface ProfileResponse {
  id: string;
  email: string;
  name: string;
  timeZone: string;
  emailVerified: boolean;
  profile: {
    playingLevel: string;
    preferredDiscipline: string | null;
    dominantHand: string;
    playingStyle: string;
    preferredRacket: string | null;
    preferredStrings: string | null;
    notes: string | null;
    defaultVisibility: string;
    defaultScoring: ScoringRules;
  };
}

export default function ProfilePage() {
  const { refresh } = useSession();
  const { data, error, isLoading, mutate } = useSWR<ProfileResponse>('/users/me', (path: string) =>
    api.get<ProfileResponse>(path),
  );

  const [form, setForm] = useState<Partial<ProfileResponse & ProfileResponse['profile']>>({});
  const [scoring, setScoring] = useState<ScoringRules | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({ name: data.name, timeZone: data.timeZone, ...data.profile });
    setScoring(data.profile.defaultScoring);
  }, [data]);

  const {
    run: save,
    isPending,
    error: saveError,
  } = useAction(async () => {
    await api.patch('/users/me', {
      name: form.name,
      timeZone: form.timeZone,
      playingLevel: form.playingLevel,
      preferredDiscipline: form.preferredDiscipline || null,
      dominantHand: form.dominantHand,
      playingStyle: form.playingStyle,
      preferredRacket: form.preferredRacket || null,
      preferredStrings: form.preferredStrings || null,
      notes: form.notes || null,
      ...(scoring ? { defaultScoring: scoring } : {}),
    });
    setSaved(true);
    void mutate();
    void refresh();
    setTimeout(() => setSaved(false), 4000);
  });

  const { run: exportAccount, isPending: exporting } = useAction(async () => {
    await downloadFile('/users/me/export', 'badminton-account-export.json');
  });

  const {
    run: changePassword,
    isPending: changingPassword,
    error: passwordError,
  } = useAction(async (current: string, next: string) => {
    await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
    // Every session is revoked, so the user must sign in again.
    window.location.href = '/login';
  });

  if (error) return <ErrorState error={error as Error} onRetry={() => void mutate()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;

  const update = (key: string, value: unknown) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader title="Profile" description="Your details, defaults and account." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title="You" />
            <form
              className="space-y-4 p-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="Name" htmlFor="name">
                <Input
                  id="name"
                  value={form.name ?? ''}
                  onChange={(event) => update('name', event.target.value)}
                />
              </Field>

              <Field
                label="Email"
                htmlFor="email"
                hint={data.emailVerified ? 'Verified' : 'Not yet verified'}
              >
                <Input id="email" value={data.email} disabled readOnly />
              </Field>

              <Field
                label="Time zone"
                htmlFor="timezone"
                hint="Determines what counts as a week or a month in your analytics."
              >
                <div className="flex gap-2">
                  <Input
                    id="timezone"
                    value={form.timeZone ?? ''}
                    onChange={(event) => update('timeZone', event.target.value)}
                  />
                  <Button type="button" onClick={() => update('timeZone', browserTimeZone())}>
                    Use device
                  </Button>
                </div>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Level" htmlFor="level">
                  <Select
                    id="level"
                    value={form.playingLevel ?? 'INTERMEDIATE'}
                    onChange={(event) => update('playingLevel', event.target.value)}
                  >
                    {PLAYING_LEVELS.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Preferred format" htmlFor="preferred">
                  <Select
                    id="preferred"
                    value={form.preferredDiscipline ?? ''}
                    onChange={(event) => update('preferredDiscipline', event.target.value)}
                  >
                    <option value="">No preference</option>
                    {DISCIPLINES.map((value) => (
                      <option key={value} value={value}>
                        {DISCIPLINE_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Dominant hand" htmlFor="hand">
                  <Select
                    id="hand"
                    value={form.dominantHand ?? 'UNKNOWN'}
                    onChange={(event) => update('dominantHand', event.target.value)}
                  >
                    {DOMINANT_HANDS.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Style" htmlFor="style">
                  <Select
                    id="style"
                    value={form.playingStyle ?? 'UNKNOWN'}
                    onChange={(event) => update('playingStyle', event.target.value)}
                  >
                    {PLAYING_STYLES.map((value) => (
                      <option key={value} value={value}>
                        {titleCase(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Racket" htmlFor="racket">
                  <Input
                    id="racket"
                    value={form.preferredRacket ?? ''}
                    onChange={(event) => update('preferredRacket', event.target.value)}
                    placeholder="Yonex Astrox 88D"
                  />
                </Field>

                <Field label="Strings" htmlFor="strings">
                  <Input
                    id="strings"
                    value={form.preferredStrings ?? ''}
                    onChange={(event) => update('preferredStrings', event.target.value)}
                    placeholder="BG65 @ 24lb"
                  />
                </Field>
              </div>

              <Field label="Notes" htmlFor="notes">
                <Textarea
                  id="notes"
                  rows={3}
                  value={form.notes ?? ''}
                  onChange={(event) => update('notes', event.target.value)}
                />
              </Field>

              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary" loading={isPending}>
                  Save changes
                </Button>
                {saved ? (
                  <span role="status" className="text-sm text-win">
                    Saved
                  </span>
                ) : null}
              </div>

              {saveError ? (
                <p role="alert" className="text-sm text-loss">
                  {saveError.message}
                </p>
              ) : null}
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Default scoring format */}
          <Card>
            <CardHeader
              title="Default scoring format"
              description="Applied to new matches. Existing matches keep the format they were played under."
            />
            <div className="space-y-3 p-4 sm:p-5">
              <div className="flex flex-wrap gap-2">
                {Object.entries(SCORING_PRESETS).map(([key, preset]) => {
                  const active =
                    scoring !== null &&
                    scoring.pointsToWin === preset.pointsToWin &&
                    scoring.winBy === preset.winBy &&
                    scoring.maxPoints === preset.maxPoints &&
                    scoring.bestOf === preset.bestOf;

                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setScoring({ ...preset })}
                      className={
                        active
                          ? 'rounded-sm border border-accent bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent'
                          : 'rounded-sm border border-line px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong'
                      }
                    >
                      {titleCase(key)}
                    </button>
                  );
                })}
              </div>

              {scoring ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(
                      [
                        ['pointsToWin', 'Target'],
                        ['winBy', 'Win by'],
                        ['maxPoints', 'Cap'],
                        ['bestOf', 'Best of'],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} label={label} htmlFor={`scoring-${key}`}>
                        <Input
                          id={`scoring-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={scoring[key]}
                          onChange={(event) =>
                            setScoring({ ...scoring, [key]: Number(event.target.value) })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <p className="text-xs text-ink-muted">Currently: {describeRules(scoring)}</p>
                </>
              ) : null}

              <Button variant="primary" onClick={() => void save()} loading={isPending}>
                Save format
              </Button>
            </div>
          </Card>

          {/* Privacy */}
          <Card>
            <CardHeader title="Privacy" />
            <div className="space-y-2 p-4 text-sm text-ink-secondary sm:p-5">
              <p>
                Your matches, statistics and notes are private. Nothing is shared with anyone else,
                and there is no public profile.
              </p>
              <p className="text-xs text-ink-muted">
                Sharing options (friends, public profiles, club leaderboards) are on the roadmap and
                will be opt-in.
              </p>
              <Button onClick={() => void exportAccount()} loading={exporting}>
                Download all my data
              </Button>
            </div>
          </Card>

          {/* Security */}
          <Card>
            <CardHeader
              title="Password"
              description="Changing your password signs you out everywhere."
            />
            <PasswordForm
              onSubmit={(current, next) => void changePassword(current, next)}
              isPending={changingPassword}
              error={passwordError?.message ?? null}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function PasswordForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (current: string, next: string) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  return (
    <form
      className="space-y-3 p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(current, next);
      }}
    >
      <Field label="Current password" htmlFor="current-password">
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>

      <Field label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </Field>

      <Button
        type="submit"
        loading={isPending}
        disabled={current.length === 0 || next.length === 0}
      >
        Change password
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : null}
    </form>
  );
}
