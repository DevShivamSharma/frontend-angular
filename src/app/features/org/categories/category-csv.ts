import type { CategoryInput, CategoryStatus } from '../../../core/categories/categories.models';

/** Longest category name: SelfCare's run past 80 characters. */
export const MAX_NAME = 160;

/**
 * `T_CODE_MASTER.typeId`s whose codes are stall categories: AAHAR (13), IITF (14), the
 * leather fairs (15, 16), multi-products (17) and F&B (18). The other types are roles,
 * company kinds, places and the like.
 */
export const SELFCARE_CATEGORY_TYPES: ReadonlySet<number> = new Set([13, 14, 15, 16, 17, 18]);

/** A row of a categories CSV as read, with what is wrong with it. */
export interface CategoryCsvRow {
  line: number;
  name: string;
  status: CategoryStatus;
  /** SelfCare's id, for a row of a `T_CODE_MASTER` export. */
  itpoId: string | null;
  problem: string | null;
}

export interface CategoryCsv {
  rows: CategoryCsvRow[];
  /** A SelfCare export (`T_CODE_MASTER`): its rows carry SelfCare's ids. */
  selfcare: boolean;
  /** Rows of a SelfCare export that are no stall category (roles, places...): left out. */
  notCategories: number;
  error: string | null;
}

/**
 * Reads a categories CSV: a header row with `name` and, optionally, `status` (active or
 * inactive; blank means active). Quoted fields may hold commas and doubled quotes. An export of
 * SelfCare's `T_CODE_MASTER` (with `id` and `typeId`) is read as such: only its stall
 * categories, each with its SelfCare id, `True`/`False` status as active/inactive.
 */
export function readCategoryCsv(text: string): CategoryCsv {
  const empty = { rows: [], selfcare: false, notCategories: 0 };
  const lines = parseCsv(text.replace(/^﻿/, '')).filter((cells) => cells.some((c) => c.trim()));
  if (!lines.length) return { ...empty, error: 'The file is empty.' };
  const header = lines[0].map((h) => h.trim().toLowerCase());
  const nameAt = header.indexOf('name');
  const statusAt = header.indexOf('status');
  const idAt = header.indexOf('id');
  const typeAt = header.indexOf('typeid');
  if (nameAt < 0) return { ...empty, error: 'The first row needs a column called name.' };
  const selfcare = idAt >= 0 && typeAt >= 0;
  const body = lines.slice(1).map((cells, i) => ({ cells, line: i + 2 }));
  const kept = selfcare
    ? body.filter(({ cells }) => SELFCARE_CATEGORY_TYPES.has(Number(cells[typeAt])))
    : body;
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const rows = kept.map(({ cells, line }): CategoryCsvRow => {
    // SelfCare's names may hold a stray line break.
    const name = (cells[nameAt] ?? '').replace(/\s+/g, ' ').trim();
    const rawStatus = statusAt >= 0 ? (cells[statusAt] ?? '').trim().toLowerCase() : '';
    const itpoId = selfcare ? (cells[idAt] ?? '').trim() : null;
    const status: CategoryStatus =
      rawStatus === 'inactive' || rawStatus === 'false' ? 'inactive' : 'active';
    const statuses = selfcare ? ['true', 'false'] : ['active', 'inactive'];
    let problem: string | null = null;
    if (!name) problem = 'No name';
    else if (name.length > MAX_NAME) problem = `Name longer than ${MAX_NAME} characters`;
    else if (itpoId !== null && !/^\d{1,12}$/.test(itpoId)) problem = 'SelfCare id is a number';
    else if (rawStatus && !statuses.includes(rawStatus)) {
      problem = `Status is ${statuses.join(' or ')}`;
    } else if (seen.has(name.toLowerCase()) || (itpoId && seenIds.has(itpoId))) {
      problem = 'Twice in the file';
    }
    if (name) seen.add(name.toLowerCase());
    if (itpoId) seenIds.add(itpoId);
    return { line, name, status, itpoId, problem };
  });
  const notCategories = body.length - kept.length;
  return {
    rows,
    selfcare,
    notCategories,
    error: rows.length
      ? null
      : selfcare
        ? 'The SelfCare export has no stall categories (typeId 13 to 18).'
        : 'The file has a header but no categories.',
  };
}

export function importable(rows: CategoryCsvRow[]): CategoryInput[] {
  return rows
    .filter((r) => !r.problem)
    .map((r) => ({ name: r.name, status: r.status, ...(r.itpoId ? { itpoId: r.itpoId } : {}) }));
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
