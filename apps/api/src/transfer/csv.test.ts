import { describe, expect, it } from 'vitest';
import { escapeCsvField, parseCsv, parseCsvRecords, toCsv } from './csv';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('name,notes\nJohn,"Good net play, poor serve"')).toEqual([
      ['name', 'notes'],
      ['John', 'Good net play, poor serve'],
    ]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('note\n"She said ""nice shot"""')).toEqual([
      ['note'],
      ['She said "nice shot"'],
    ]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('note\n"line one\nline two"')).toEqual([['note'], ['line one\nline two']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿date,discipline\n2026-01-01,SINGLES')[0]).toEqual(['date', 'discipline']);
  });

  it('ignores a trailing newline rather than emitting an empty row', () => {
    expect(parseCsv('a\n1\n')).toHaveLength(2);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvRecords', () => {
  it('keys records by lower-cased header and pads ragged rows', () => {
    const { headers, records } = parseCsvRecords('Date,Discipline,Notes\n2026-01-01,SINGLES');
    expect(headers).toEqual(['date', 'discipline', 'notes']);
    expect(records[0]).toEqual({ date: '2026-01-01', discipline: 'SINGLES', notes: '' });
  });
});

describe('escapeCsvField', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('one\ntwo')).toBe('"one\ntwo"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(escapeCsvField('=1+1')).toBe("'=1+1");
    expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvField('+cmd')).toBe("'+cmd");
  });

  it('leaves negative numbers alone', () => {
    // The formula guard must not corrupt a point differential of -7.
    expect(escapeCsvField(-7)).toBe('-7');
    expect(escapeCsvField('-7')).toBe('-7');
    expect(escapeCsvField(-12.5)).toBe('-12.5');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('round-trips through the parser', () => {
    const csv = toCsv(
      ['date', 'opponent', 'game1', 'pointDifferential'],
      [['2026-08-16', 'Carter, John', '21-18', -7]],
    );
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(['2026-08-16', 'Carter, John', '21-18', '-7']);
  });
});
