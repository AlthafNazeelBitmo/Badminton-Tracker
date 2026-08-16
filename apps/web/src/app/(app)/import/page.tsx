'use client';

import { useState } from 'react';
import type { ImportPreviewResponse } from '@badminton/contracts';
import { api, downloadFile } from '@/lib/api';
import { invalidateMatchData, useAction } from '@/lib/hooks';
import { Badge, Button, Card, CardHeader, PageHeader, Select, Textarea, cx } from '@/components/ui';

/**
 * Import and export.
 *
 * The import is deliberately two steps. Nothing is written until the preview has shown,
 * row by row, exactly what will happen — how many rows are valid, which are duplicates,
 * and which players and venues would be created. Silent partial imports are the failure
 * mode this design exists to prevent.
 */
export default function ImportExportPage() {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [committed, setCommitted] = useState<string | null>(null);
  const [dataset, setDataset] = useState('matches');
  const [format, setFormat] = useState('csv');

  const {
    run: runPreview,
    isPending: previewing,
    error: previewError,
  } = useAction(async () => {
    setCommitted(null);
    const result = await api.post<ImportPreviewResponse>('/transfer/import/preview', { csv });
    setPreview(result);
    return result;
  });

  const {
    run: runCommit,
    isPending: committing,
    error: commitError,
  } = useAction(async () => {
    if (!preview) return null;
    const acceptRows = preview.rows
      .filter((row) => row.status === 'READY')
      .map((row) => row.rowNumber);

    const result = await api.post<{
      importedMatches: number;
      createdPlayers: number;
      createdVenues: number;
    }>('/transfer/import/commit', { csv, acceptRows });

    invalidateMatchData();
    setPreview(null);
    setCsv('');
    setCommitted(
      `Imported ${result.importedMatches} match${result.importedMatches === 1 ? '' : 'es'}, ` +
        `creating ${result.createdPlayers} player(s) and ${result.createdVenues} venue(s).`,
    );
    return result;
  });

  const { run: runExport, isPending: exporting } = useAction(async () => {
    await downloadFile(
      `/transfer/export?dataset=${dataset}&format=${format}`,
      `badminton-${dataset}.${format}`,
    );
  });

  const { run: getTemplate } = useAction(async () => {
    await downloadFile('/transfer/import/template', 'badminton-import-template.csv');
  });

  const onFile = async (file: File) => {
    setCsv(await file.text());
    setPreview(null);
    setCommitted(null);
  };

  return (
    <>
      <PageHeader
        title="Import & export"
        description="Bring in history from a spreadsheet, or take all your data out."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Export */}
        <Card>
          <CardHeader title="Export" description="Your data, in a format other tools can read." />
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs font-medium text-ink-secondary">Data</span>
                <Select value={dataset} onChange={(event) => setDataset(event.target.value)}>
                  <option value="matches">Matches</option>
                  <option value="sessions">Sessions</option>
                  <option value="players">Players</option>
                  <option value="venues">Venues</option>
                  <option value="statistics">Statistics</option>
                </Select>
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-xs font-medium text-ink-secondary">Format</span>
                <Select value={format} onChange={(event) => setFormat(event.target.value)}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </Select>
              </label>
            </div>

            <Button variant="primary" onClick={() => void runExport()} loading={exporting}>
              Download
            </Button>

            <p className="text-xs text-ink-muted">
              The match CSV uses the same columns the importer accepts, so you can export, edit in a
              spreadsheet and import the file straight back.
            </p>
          </div>
        </Card>

        {/* Import */}
        <Card>
          <CardHeader
            title="Import"
            description="Nothing is saved until you have seen the preview."
            action={
              <button
                type="button"
                onClick={() => void getTemplate()}
                className="text-xs font-medium text-accent hover:underline"
              >
                Get template
              </button>
            }
          />
          <div className="space-y-3 p-4 sm:p-5">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-secondary">
                Choose a CSV file
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onFile(file);
                }}
                className="block w-full text-sm text-ink-secondary file:mr-3 file:rounded file:border file:border-line file:bg-surface-raised file:px-3 file:py-2 file:text-sm file:text-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-secondary">
                Or paste the rows
              </span>
              <Textarea
                rows={5}
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setPreview(null);
                }}
                placeholder="date,venue,sessionType,discipline,partner,opponent1,…"
                className="font-mono text-xs"
              />
            </label>

            <Button
              variant="primary"
              onClick={() => void runPreview()}
              loading={previewing}
              disabled={csv.trim().length === 0}
            >
              Preview import
            </Button>

            {previewError ? (
              <div role="alert" className="rounded border border-loss px-3 py-2 text-sm text-loss">
                <p>{previewError.message}</p>
                {previewError.details?.length ? (
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {previewError.details.map((detail, index) => (
                      <li key={index}>{detail.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {committed ? (
              <p
                role="status"
                className="rounded border border-line bg-accent-soft px-3 py-2 text-sm text-ink"
              >
                {committed}
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      {preview ? (
        <Card className="mt-4">
          <CardHeader
            title="Preview"
            description={`${preview.totalRows} rows read · ${preview.readyRows} ready · ${preview.duplicateRows} duplicates · ${preview.invalidRows} with problems`}
            action={
              <Button
                variant="primary"
                onClick={() => void runCommit()}
                loading={committing}
                disabled={preview.readyRows === 0}
              >
                Import {preview.readyRows} row{preview.readyRows === 1 ? '' : 's'}
              </Button>
            }
          />

          {commitError ? (
            <p
              role="alert"
              className="mx-4 mt-3 rounded border border-loss px-3 py-2 text-sm text-loss sm:mx-5"
            >
              {commitError.message}
            </p>
          ) : null}

          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-max text-sm">
              <caption className="sr-only">Rows found in the uploaded file</caption>
              <thead className="sticky top-0 bg-surface-raised">
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Row
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Format
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Opponents
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Scores
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className={cx(row.status === 'INVALID' ? 'bg-surface-sunken' : '')}
                  >
                    <th scope="row" className="px-3 py-2 text-left font-normal text-ink-muted">
                      {row.rowNumber}
                    </th>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          row.status === 'READY'
                            ? 'win'
                            : row.status === 'DUPLICATE'
                              ? 'warn'
                              : 'loss'
                        }
                      >
                        {row.status === 'READY'
                          ? 'Ready'
                          : row.status === 'DUPLICATE'
                            ? 'Duplicate'
                            : 'Problem'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{row.date ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-secondary">{row.discipline ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {row.opponentNames.join(' & ') || '—'}
                      {row.newPlayers.length > 0 ? (
                        <span className="ml-1 text-xs text-accent">
                          (+{row.newPlayers.length} new)
                        </span>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-2 text-ink-secondary">
                      {row.games
                        .map((game) => `${game.myScore}-${game.opponentScore}`)
                        .join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2">
                      {row.issues.length === 0 ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <ul className="space-y-0.5 text-xs text-loss">
                          {row.issues.map((issue, index) => (
                            <li key={index}>
                              {issue.column ? `${issue.column}: ` : ''}
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
