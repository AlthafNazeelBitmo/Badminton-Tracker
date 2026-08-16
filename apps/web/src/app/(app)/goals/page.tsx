'use client';

import { useState } from 'react';
import {
  GOAL_METRICS,
  GOAL_METRIC_LABELS,
  PERCENTAGE_GOAL_METRICS,
  type GoalMetric,
  type GoalProgress,
} from '@badminton/contracts';
import { api } from '@/lib/api';
import { useAction, useGoals } from '@/lib/hooks';
import { formatDate } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Meter,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';

/**
 * Goals.
 *
 * Progress is computed from matches on every read, never stored, so a goal cannot claim
 * you have played 50 matches after you delete one. The only thing persisted is the goal
 * itself and the moment it was first achieved.
 */
export default function GoalsPage() {
  const { data, error, isLoading, mutate } = useGoals();
  const [creating, setCreating] = useState(false);

  if (error) return <ErrorState error={error as Error} onRetry={() => void mutate()} />;

  const goals = data?.items ?? [];
  const active = goals.filter((goal) => goal.status === 'ACTIVE');
  const finished = goals.filter((goal) => goal.status !== 'ACTIVE');

  return (
    <>
      <PageHeader
        title="Goals"
        description="Set a target and watch it fill from the matches you record."
        action={
          <Button
            variant={creating ? 'ghost' : 'primary'}
            onClick={() => setCreating((open) => !open)}
          >
            {creating ? 'Cancel' : 'New goal'}
          </Button>
        }
      />

      {creating ? (
        <GoalForm
          onCreated={() => {
            setCreating(false);
            void mutate();
          }}
        />
      ) : null}

      {isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            title="No goals yet"
            icon="🎯"
            description="A goal turns a vague intention into something the dashboard can measure — 100 matches this year, or a 60% win rate."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create your first goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {active.length > 0 ? (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                In progress
              </h2>
              <ul className="space-y-3">
                {active.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} onChanged={() => void mutate()} />
                ))}
              </ul>
            </section>
          ) : null}

          {finished.length > 0 ? (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Finished
              </h2>
              <ul className="space-y-3">
                {finished.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} onChanged={() => void mutate()} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

function GoalCard({ goal, onChanged }: { goal: GoalProgress; onChanged: () => void }) {
  const { run: remove, isPending } = useAction(async () => {
    await api.delete(`/goals/${goal.id}`);
    onChanged();
  });

  const isPercentage = PERCENTAGE_GOAL_METRICS.includes(goal.metric);
  const formatValue = (value: number) =>
    isPercentage ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString();

  const tone = goal.status === 'ACHIEVED' ? 'win' : goal.status === 'MISSED' ? 'loss' : 'neutral';

  return (
    <li>
      <Card className="card-pad">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-ink">{goal.title}</h3>
              <Badge tone={tone}>
                {goal.status === 'ACHIEVED'
                  ? 'Achieved'
                  : goal.status === 'MISSED'
                    ? 'Missed'
                    : goal.status === 'ARCHIVED'
                      ? 'Archived'
                      : 'Active'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {GOAL_METRIC_LABELS[goal.metric]}
              {goal.discipline ? ` · ${goal.discipline.toLowerCase().replace('_', ' ')}` : ''}
              {goal.deadline ? ` · by ${formatDate(goal.deadline)}` : ''}
            </p>
          </div>

          <p className="tabular shrink-0 text-sm font-medium">
            {formatValue(goal.currentValue)}{' '}
            <span className="text-ink-muted">of {formatValue(goal.targetValue)}</span>
          </p>
        </div>

        <Meter
          className="mt-3"
          value={goal.percentComplete}
          max={100}
          label={`${goal.title}: ${goal.percentComplete}% complete`}
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
          <span>
            {goal.percentComplete}% complete
            {goal.daysRemaining !== null && goal.status === 'ACTIVE'
              ? goal.daysRemaining >= 0
                ? ` · ${goal.daysRemaining} day${goal.daysRemaining === 1 ? '' : 's'} left`
                : ' · deadline passed'
              : ''}
            {goal.requiredDailyPace !== null ? ` · needs ${goal.requiredDailyPace} per day` : ''}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void remove()} loading={isPending}>
            Delete
          </Button>
        </div>
      </Card>
    </li>
  );
}

function GoalForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState<GoalMetric>('MATCHES_PLAYED');
  const [targetValue, setTargetValue] = useState('50');
  const [deadline, setDeadline] = useState('');

  const { run, isPending, error } = useAction(async () => {
    await api.post('/goals', {
      title: title.trim(),
      metric,
      targetValue: Number(targetValue),
      deadline: deadline || null,
    });
    onCreated();
  });

  const isPercentage = PERCENTAGE_GOAL_METRICS.includes(metric);

  return (
    <Card className="card-pad mb-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Field label="Title" htmlFor="goal-title" required>
          <Input
            id="goal-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Play 100 matches this year"
            required
          />
        </Field>

        <Field label="Measure" htmlFor="goal-metric">
          <Select
            id="goal-metric"
            value={metric}
            onChange={(event) => setMetric(event.target.value as GoalMetric)}
          >
            {GOAL_METRICS.map((value) => (
              <option key={value} value={value}>
                {GOAL_METRIC_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Target"
          htmlFor="goal-target"
          hint={isPercentage ? 'A percentage between 0 and 100.' : undefined}
        >
          <Input
            id="goal-target"
            type="number"
            inputMode="numeric"
            min={0}
            max={isPercentage ? 100 : undefined}
            value={targetValue}
            onChange={(event) => setTargetValue(event.target.value)}
            required
          />
        </Field>

        <Field label="Deadline" htmlFor="goal-deadline" hint="Optional">
          <Input
            id="goal-deadline"
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </Field>

        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" loading={isPending} disabled={!title.trim()}>
            Create goal
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
