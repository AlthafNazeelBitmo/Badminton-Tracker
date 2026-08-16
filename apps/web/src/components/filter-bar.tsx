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
import { cx } from './ui';

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
    <div className={cx('card', className)}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div
          role="group"
          aria-label="Date range"
          className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1"
        >
          {PRESETS.map((preset) => {
            const active = filter.preset === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ preset: preset.value, from: undefined, to: undefined })}
                className={cx(
                  'shrink-0 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-ink-secondary hover:border-line-strong',
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {showDimensions ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="shrink-0 rounded-sm border border-line px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong"
          >
            Filters
            {activeDimensions > 0 ? (
              <span className="ml-1.5 rounded-sm bg-accent px-1.5 text-accent-ink">
                {activeDimensions}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {showDimensions && expanded ? (
        <div className="grid gap-3 border-t border-line px-3 py-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">Discipline</span>
            <select
              value={filter.discipline ?? ''}
              onChange={(event) =>
                onChange({
                  discipline: (event.target.value || undefined) as FilterState['discipline'],
                })
              }
              className="h-10 w-full rounded border border-line bg-surface-raised px-2 text-sm"
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
              className="h-10 w-full rounded border border-line bg-surface-raised px-2 text-sm"
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
              className="h-10 w-full rounded border border-line bg-surface-raised px-2 text-sm"
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
              className="justify-self-start text-xs text-accent hover:underline sm:col-span-3"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
