'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import {
  invalidateMatchData,
  useAction,
  useFilterState,
  useVenueAnalytics,
  useVenues,
} from '@/lib/hooks';
import { EM_DASH, duration, formatShortDate, percent, signed } from '@/lib/format';
import { FilterBar } from '@/components/filter-bar';
import { RankedBars } from '@/components/charts';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { StatsTable } from '@/components/stats-table';

export default function VenuesPage() {
  const { filter, update, query } = useFilterState({ preset: 'ALL_TIME' });
  const analytics = useVenueAnalytics(query);
  const venues = useVenues();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');

  const {
    run: addVenue,
    isPending,
    error,
  } = useAction(async () => {
    await api.post('/venues', { name, city: city || null });
    setName('');
    setCity('');
    setAdding(false);
    invalidateMatchData();
    void venues.mutate();
  });

  if (analytics.error) {
    return <ErrorState error={analytics.error as Error} onRetry={() => void analytics.mutate()} />;
  }

  const entries = analytics.data ?? [];
  const played = entries.filter((entry) => entry.stats.matches > 0);

  return (
    <>
      <PageHeader
        title="Venues"
        description="Whether where you play seems to make a difference."
        action={
          <Button variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding((open) => !open)}>
            {adding ? 'Cancel' : 'Add venue'}
          </Button>
        }
      />

      {adding ? (
        <Card className="card-pad mb-4">
          <form
            className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void addVenue();
            }}
          >
            <Field label="Name" htmlFor="venue-name" required>
              <Input
                id="venue-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Riverside Sports Hall"
                required
              />
            </Field>
            <Field label="City" htmlFor="venue-city">
              <Input
                id="venue-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" loading={isPending} disabled={!name.trim()}>
              Save
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-loss">
              {error.message}
            </p>
          ) : null}
        </Card>
      ) : null}

      <FilterBar filter={filter} onChange={update} className="mb-4" showDimensions={false} />

      {analytics.isLoading && !analytics.data ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      ) : played.length === 0 ? (
        <Card>
          <EmptyState
            title="No venue data yet"
            icon="📍"
            description="Record a match with a venue and its performance breakdown appears here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Win rate by venue"
              description="Who you tend to play at each venue is part of any difference you see here."
            />
            <div className="p-4 sm:p-5">
              <RankedBars
                valueLabel="win rate"
                data={[...played]
                  .sort((a, b) => (b.stats.winRate ?? -1) - (a.stats.winRate ?? -1))
                  .map((entry) => ({
                    label: entry.subject.name,
                    value: entry.stats.winRate,
                    detail: `${entry.stats.matches} matches · ${signed(
                      entry.stats.pointDifferential,
                    )} points`,
                  }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Detail" description="Singles and doubles split out per venue." />
            <div className="overflow-x-auto p-4 sm:p-5">
              <StatsTable
                caption="Performance by venue"
                columns={[
                  { key: 'name', header: 'Venue' },
                  { key: 'matches', header: 'Played', align: 'right' },
                  { key: 'winRate', header: 'Win rate', align: 'right' },
                  { key: 'singles', header: 'Singles', align: 'right' },
                  { key: 'doubles', header: 'Doubles', align: 'right' },
                  { key: 'avgPoints', header: 'Avg points', align: 'right' },
                  { key: 'duration', header: 'Avg length', align: 'right' },
                  { key: 'last', header: 'Last played', align: 'right' },
                ]}
                rows={played.map((entry) => ({
                  key: entry.subject.id ?? 'none',
                  name: entry.subject.city
                    ? `${entry.subject.name} · ${entry.subject.city}`
                    : entry.subject.name,
                  matches: entry.stats.matches,
                  winRate: percent(entry.stats.winRate),
                  singles:
                    entry.singles.matches === 0
                      ? EM_DASH
                      : `${percent(entry.singles.winRate)} (${entry.singles.matches})`,
                  doubles:
                    entry.doubles.matches === 0
                      ? EM_DASH
                      : `${percent(entry.doubles.winRate)} (${entry.doubles.matches})`,
                  avgPoints: entry.stats.averagePointsScoredPerGame ?? EM_DASH,
                  duration: duration(entry.stats.averageMatchSeconds),
                  last: formatShortDate(entry.lastPlayedAt),
                }))}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
