/**
 * A small, correct CSV reader and writer.
 *
 * Bringing in a CSV library for this would be reasonable, but the format the importer
 * accepts is narrow and the parser is a state machine with three states. Writing it
 * here means quoting, embedded commas, embedded newlines and escaped quotes all behave
 * exactly as documented and are covered by tests, with no dependency to keep current.
 *
 * Handled: RFC 4180 quoting, CRLF and LF line endings, a UTF-8 byte-order mark, and
 * ragged rows (missing trailing columns become empty strings).
 */

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];

  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty field; that is not a row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      endRow();
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Parses a CSV with a header row into keyed records.
 *
 * Headers are matched case- and separator-insensitively against `canonicalColumns`, so
 * a spreadsheet saying `Date`, `DURATION MINUTES` or `duration_minutes` all resolve to
 * the canonical `durationMinutes` key. Canonicalising here — rather than lower-casing
 * and hoping the reader agrees — is what stops a column from being silently ignored
 * because the caller looked it up under a different spelling.
 *
 * Unrecognised headers are kept under their lower-cased name and simply unused.
 */
export function parseCsvRecords(
  input: string,
  canonicalColumns: readonly string[] = [],
): {
  headers: string[];
  records: Array<Record<string, string>>;
} {
  const rows = parseCsv(input);
  const headerRow = rows[0];
  if (!headerRow) return { headers: [], records: [] };

  const canonicalByKey = new Map(
    canonicalColumns.map((column) => [normaliseHeader(column), column]),
  );

  const headers = headerRow.map((header) => {
    const key = normaliseHeader(header);
    return canonicalByKey.get(key) ?? header.trim().toLowerCase();
  });

  const records = rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      record[header] = (row[columnIndex] ?? '').trim();
    });
    return record;
  });

  return { headers, records };
}

/** Reduces a header to a comparison key: lower-cased, stripped of spaces and separators. */
function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * Serialises rows to CSV.
 *
 * Fields beginning with `=`, `+`, `-` or `@` are prefixed with a single quote. Without
 * that, a spreadsheet opens an exported "name" of `=1+1` as a live formula — the CSV
 * injection problem. The exported file stays readable and no longer executes.
 */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\r\n');
}

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * A plain number, including a negative one. These are exempt from the formula guard:
 * a point differential of -7 is data, and quoting it into `'-7` would corrupt every
 * negative value in the export while protecting against nothing.
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (text.length > 0 && FORMULA_PREFIXES.includes(text[0]!) && !NUMERIC.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
