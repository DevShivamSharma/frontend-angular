import type { CategoryInput, CategoryStatus } from '../../../core/categories/categories.models';

/** A row of a categories CSV as read, with what is wrong with it. */
export interface CategoryCsvRow {
  line: number;
  name: string;
  status: CategoryStatus;
  problem: string | null;
}

/**
 * Reads a categories CSV: a header row with `name` and, optionally, `status` (active or
 * inactive; blank means active). Quoted fields may hold commas and doubled quotes.
 */
export function readCategoryCsv(text: string): { rows: CategoryCsvRow[]; error: string | null } {
  const lines = parseCsv(text.replace(/^﻿/, '')).filter((cells) => cells.some((c) => c.trim()));
  if (!lines.length) return { rows: [], error: 'The file is empty.' };
  const header = lines[0].map((h) => h.trim().toLowerCase());
  const nameAt = header.indexOf('name');
  const statusAt = header.indexOf('status');
  if (nameAt < 0) return { rows: [], error: 'The first row needs a column called name.' };
  const seen = new Set<string>();
  const rows = lines.slice(1).map((cells, i): CategoryCsvRow => {
    const name = (cells[nameAt] ?? '').trim();
    const rawStatus = statusAt >= 0 ? (cells[statusAt] ?? '').trim().toLowerCase() : '';
    const status: CategoryStatus = rawStatus === 'inactive' ? 'inactive' : 'active';
    let problem: string | null = null;
    if (!name) problem = 'No name';
    else if (name.length > 80) problem = 'Name longer than 80 characters';
    else if (rawStatus && rawStatus !== 'active' && rawStatus !== 'inactive') {
      problem = 'Status is active or inactive';
    } else if (seen.has(name.toLowerCase())) problem = 'Twice in the file';
    if (name) seen.add(name.toLowerCase());
    return { line: i + 2, name, status, problem };
  });
  return { rows, error: rows.length ? null : 'The file has a header but no categories.' };
}

export function importable(rows: CategoryCsvRow[]): CategoryInput[] {
  return rows.filter((r) => !r.problem).map((r) => ({ name: r.name, status: r.status }));
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
