import { z } from 'zod';
import { DISCIPLINES, SESSION_TYPES } from './enums';

/**
 * CSV import contract. One row per match; games are flattened into `game1`…`game5`
 * columns written as `21-18`. Anything the importer cannot parse is reported back
 * row by row rather than silently dropped.
 */
export const CSV_IMPORT_COLUMNS = [
  'date',
  'venue',
  'sessionType',
  'discipline',
  'partner',
  'opponent1',
  'opponent2',
  'game1',
  'game2',
  'game3',
  'game4',
  'game5',
  'durationMinutes',
  'difficulty',
  'notes',
] as const;

export type CsvImportColumn = (typeof CSV_IMPORT_COLUMNS)[number];

export const CSV_REQUIRED_COLUMNS: readonly CsvImportColumn[] = [
  'date',
  'discipline',
  'opponent1',
  'game1',
];

/**
 * The downloadable template. Every row carries one value per column — including the
 * empty game columns — because a short row silently shifts every later value into the
 * wrong field, which is exactly the kind of import corruption this format exists to
 * prevent. A test asserts that the importer accepts this template unchanged.
 */
export const CSV_TEMPLATE = [
  CSV_IMPORT_COLUMNS.join(','),
  '2026-08-01,Riverside Sports Hall,CASUAL,SINGLES,,John Carter,,21-18,19-21,21-16,,,42,3,Slow start then found my length',
  '2026-08-03,Riverside Sports Hall,COMPETITIVE,DOUBLES,Ahmed Rahim,John Carter,Priya Nair,21-15,21-19,,,,35,4,',
].join('\n');

const gameCellPattern = /^\s*(\d{1,3})\s*[-–:]\s*(\d{1,3})\s*$/;

/** Parses a `21-18` cell into a score line. Returns null for blank or malformed cells. */
export function parseGameCell(cell: string | undefined | null): {
  myScore: number;
  opponentScore: number;
} | null {
  if (cell == null) return null;
  const match = gameCellPattern.exec(cell);
  if (!match) return null;
  const myScore = Number(match[1]);
  const opponentScore = Number(match[2]);
  if (!Number.isInteger(myScore) || !Number.isInteger(opponentScore)) return null;
  return { myScore, opponentScore };
}

export const importRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  date: z.string().min(1),
  venue: z.string().optional(),
  sessionType: z.string().optional(),
  discipline: z.string().min(1),
  partner: z.string().optional(),
  opponent1: z.string().min(1),
  opponent2: z.string().optional(),
  game1: z.string().optional(),
  game2: z.string().optional(),
  game3: z.string().optional(),
  game4: z.string().optional(),
  game5: z.string().optional(),
  durationMinutes: z.string().optional(),
  difficulty: z.string().optional(),
  notes: z.string().optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importPreviewSchema = z.object({
  /** Raw CSV text. Bounded so a pasted spreadsheet cannot exhaust server memory. */
  csv: z.string().min(1).max(2_000_000),
  /** Skip rows that look like matches already stored (same day, opponents and scores). */
  skipDuplicates: z.boolean().default(true),
});
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;

export const importCommitSchema = importPreviewSchema.extend({
  /** Row numbers the user confirmed after reviewing the preview. */
  acceptRows: z.array(z.number().int().min(1)).min(1).max(10_000),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

export interface ImportIssue {
  rowNumber: number;
  column: string | null;
  code: string;
  message: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  status: 'READY' | 'INVALID' | 'DUPLICATE';
  date: string | null;
  discipline: (typeof DISCIPLINES)[number] | null;
  sessionType: (typeof SESSION_TYPES)[number] | null;
  venueName: string | null;
  partnerNames: string[];
  opponentNames: string[];
  games: Array<{ myScore: number; opponentScore: number }>;
  durationMinutes: number | null;
  difficulty: number | null;
  notes: string | null;
  result: 'WIN' | 'LOSS' | 'DRAW' | null;
  issues: ImportIssue[];
  /** Players that do not yet exist and would be created on commit. */
  newPlayers: string[];
  newVenue: string | null;
}

export interface ImportPreviewResponse {
  totalRows: number;
  readyRows: number;
  invalidRows: number;
  duplicateRows: number;
  rows: ImportPreviewRow[];
  issues: ImportIssue[];
}

export interface ImportCommitResponse {
  importedMatches: number;
  createdSessions: number;
  createdPlayers: number;
  createdVenues: number;
  skippedRows: number;
  issues: ImportIssue[];
}

export const EXPORT_FORMATS = ['csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_DATASETS = ['matches', 'sessions', 'players', 'venues', 'statistics'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export const exportQuerySchema = z.object({
  dataset: z.enum(EXPORT_DATASETS).default('matches'),
  format: z.enum(EXPORT_FORMATS).default('csv'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ExportQuery = z.infer<typeof exportQuerySchema>;
