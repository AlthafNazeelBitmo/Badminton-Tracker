'use client';

import { useState } from 'react';
import {
  DISCIPLINES,
  DISCIPLINE_LABELS,
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
  type DateRangePreset,
} from '@badminton/contracts';
import type { FilterState } from '@/lib/hooks';
import { useVenues } from '@/lib/hooks';
import { SlidersHorizontal } from 'lucide-react';
import { Segmented, cx, selectClasses } from './ui';

/**
 * The global analytics filter.
 *
 * One control bar drives every analytics page, because a filter that means something
 * different on each screen is worse than no filter. Presets sit in a single scrollable
 * row above the charts; the less-used dimensions are behind a disclosure so the common
 * case — change the period — stays one tap.
 */
const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'LAST_30_DAYS', label: '30 days' },
  { value: 'LAST_90_DAYS', label: '3 months' },
  { value: 'LAST_180_DAYS', label: '6 months' },
  { value: 'THIS_YEAR', label: 'This year' },
  { value: 'LAST_YEAR', label: 'Last year' },
  { value: 'ALL_TIME', label: 'All time' },
];

export function FilterBar({
  filter,
  onChange,
  className,
  showDimensions = true,
}: {
  filter: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  className?: string;
  showDimensions?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: venues } = useVenues('?pageSize=50&sort=MOST_PLAYED');

  const activeDimensions = [filter.discipline, filter.sessionType, filter.venueId].filter(
    Boolean,
  ).length;

  return (
    <div className={cx('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Date range"
          options={PRESETS}
          value={filter.preset}
          onChange={(preset) => onChange({ preset, from: undefined, to: undefined })}
          className="min-w-0"
        />

        {showDimensions ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className={cx(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium shadow-card transition-colors',
              expanded || activeDimensions > 0
                ? 'border-line-strong bg-surface-raised text-ink'
                : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink',
            )}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            Filters
            {activeDimensions > 0 ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-ink">
                {activeDimensions}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {showDimensions && expanded ? (
        <div className="card animate-in grid gap-3 p-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">Discipline</span>
            <select
              value={filter.discipline ?? ''}
              onChange={(event) =>
                onChange({
                  discipline: (event.target.value || undefined) as FilterState['discipline'],
                })
              }
              className={cx(selectClasses, 'h-10')}
            >
              <option value="">All</option>
              {DISCIPLINES.map((value) => (
                <option key={value} value={value}>
                  {DISCIPLINE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">Session type</span>
            <select
              value={filter.sessionType ?? ''}
              onChange={(event) =>
                onChange({
                  sessionType: (event.target.value || undefined) as FilterState['sessionType'],
                })
              }
              className={cx(selectClasses, 'h-10')}
            >
              <option value="">All</option>
              {SESSION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {SESSION_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">Venue</span>
            <select
              value={filter.venueId ?? ''}
              onChange={(event) => onChange({ venueId: event.target.value || undefined })}
              className={cx(selectClasses, 'h-10')}
            >
              <option value="">All</option>
              {(venues?.items ?? []).map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          </label>

          {activeDimensions > 0 ? (
            <button
              type="button"
              onClick={() =>
                onChange({ discipline: undefined, sessionType: undefined, venueId: undefined })
              }
              className="link justify-self-start text-xs sm:col-span-3"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
