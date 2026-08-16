'use client';

import type { ReactNode } from 'react';
import { cx } from './ui';

export interface Column {
  key: string;
  header: string;
  align?: 'left' | 'right';
}

export interface Row {
  key: string;
  [field: string]: ReactNode;
}

/**
 * A plain data table.
 *
 * Every chart in the app has one of these behind it. That is the accessibility answer
 * for readers who cannot use a chart, the fallback when a colour is hard to tell apart,
 * and the honest way to show a number that a bar can only approximate.
 *
 * Real `<caption>`, `<th scope>` and tabular figures — the semantics a screen reader
 * needs to read a grid of numbers aloud coherently.
 */
export function StatsTable({
  caption,
  columns,
  rows,
  emptyMessage = 'Nothing to show yet.',
  highlightFirstColumn = true,
}: {
  caption: string;
  columns: Column[];
  rows: Row[];
  emptyMessage?: string;
  highlightFirstColumn?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <table className="w-full min-w-max text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cx(
                'whitespace-nowrap px-2 pb-2 text-xs font-medium uppercase tracking-wide text-ink-muted',
                column.align === 'right' ? 'text-right' : 'text-left',
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => (
          <tr key={row.key}>
            {columns.map((column, index) => {
              const content = row[column.key];
              const className = cx(
                'whitespace-nowrap px-2 py-2.5',
                column.align === 'right' ? 'text-right' : 'text-left',
                index === 0 && highlightFirstColumn ? 'font-medium text-ink' : 'text-ink-secondary',
              );

              // The first column identifies the row, so it is a header cell.
              return index === 0 && highlightFirstColumn ? (
                <th key={column.key} scope="row" className={cx(className, 'text-left font-medium')}>
                  {content}
                </th>
              ) : (
                <td key={column.key} className={className}>
                  {content}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
