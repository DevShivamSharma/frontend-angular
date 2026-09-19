import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

import { Hall } from '../models/hall.model';
import { Stall } from '../models/stall.model';
import { normalizeStall, num, shapeOf, withinHall } from '../geometry/planner-geometry';

/** Result of reading a workbook, before it is applied to planner state. */
export interface ExcelImportResult {
  hall: Hall;
  /** Every stall row that was read, including out-of-bounds ones. */
  imported: Stall[];
  /** Rows that fit inside the imported hall — the only ones React keeps. */
  valid: Stall[];
}

type SheetRow = Record<string, unknown>;

/**
 * Excel import/template export ported from `App.js:531-546`.
 *
 * Header and sheet-name matching is intentionally forgiving: names are
 * lowercased and stripped of spaces, underscores and hyphens before comparing.
 */
@Injectable({ providedIn: 'root' })
export class ExcelLayoutService {
  /**
   * Parse a workbook buffer into a hall plus its stalls.
   * Throws `Hall data not found in Excel.` when no hall row can be located,
   * matching the React error text.
   */
  parse(buffer: ArrayBuffer): ExcelImportResult {
    const wb = XLSX.read(buffer, { type: 'array' });

    const rows = (name: string): SheetRow[] => {
      const s = wb.Sheets[name];
      return s ? (XLSX.utils.sheet_to_json(s, { defval: '' }) as SheetRow[]) : [];
    };

    const sheet = (names: string[]): string | undefined =>
      wb.SheetNames.find(n => names.includes(norm(n)));

    const hallSheet = sheet(['hall', 'halls']);
    const stallSheet = sheet(['stall', 'stalls']);
    const layoutSheet = sheet(['layout', 'layouts']);

    const hallRows = hallSheet ? rows(hallSheet) : [];
    const hrow = hallRows[0] || (layoutSheet ? rows(layoutSheet)[0] : null);
    if (!hrow) throw new Error('Hall data not found in Excel.');

    const hall: Hall = {
      id: `excel-hall-${Date.now()}`,
      name: String(get(hrow, ['Hall Name', 'HallName', 'Name']) || 'Imported Hall').trim(),
      shape: shapeOf(get(hrow, ['Shape', 'Hall Shape'])),
      width: num(get(hrow, ['Hall Width', 'HallWidth', 'width']), 40),
      length: num(get(hrow, ['Hall Length', 'HallLength', 'length']), 40),
      radius: num(get(hrow, ['Hall Radius', 'HallRadius', 'radius']), 20)
    };

    if (hall.shape === 'CIRCLE') {
      hall.width = 0;
      hall.length = 0;
    } else {
      hall.radius = 0;
    }

    const sourceRows = stallSheet ? rows(stallSheet) : layoutSheet ? rows(layoutSheet) : [];

    const imported = sourceRows.map((r, i) =>
      normalizeStall(
        {
          // React passes the raw `''` through here, which makes every id-less
          // imported stall share the id `''`. Angular's `@for` track expression
          // rejects duplicate keys, so an absent id is converted to `undefined`
          // and `normalizeStall` generates a unique local id instead.
          id: get(r, ['id', 'Stall Id', 'StallID']) || undefined,
          name: get(r, ['Stall Name', 'StallName', 'Shop Name', 'ShopName', 'Name']),
          width: get(r, ['Stall Width', 'StallWidth', 'Width']),
          length: get(r, ['Stall Length', 'StallLength', 'Length']),
          height: get(r, ['Stall Height', 'StallHeight', 'Height']),
          posX: get(r, ['X-Pos', 'X Pos', 'X', 'PosX']),
          posZ: get(r, ['Z-Pos', 'Z Pos', 'Z', 'PosZ']),
          color: get(r, ['Color', 'Stall Color']),
          gateSide: get(r, ['Gate Side', 'GateSide', 'Opening Side'])
        },
        hall.id,
        `Shop ${i + 1}`
      )
    );

    // Out-of-bounds rows are dropped. Overlapping rows are deliberately kept,
    // matching React (`App.js:544`).
    const valid = imported.filter(s => withinHall(hall, s, s.posX, s.posZ));

    return { hall, imported, valid };
  }

  /** Writes `3D_Stall_Layout_Template.xlsx`. `App.js:546`. */
  downloadTemplate(): void {
    const data = [
      {
        'Stall Name': 'Shop 1',
        'Hall Name': 'Main Exhibition Hall A',
        Shape: 'SQUARE',
        'Hall Width': 40,
        'Hall Length': 40,
        'Stall Width': 8,
        'Stall Length': 8,
        'Stall Height': 4,
        'X-Pos': -16,
        'Z-Pos': -16,
        Color: '#3498db',
        'Gate Side': 'FRONT'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Layout');
    XLSX.writeFile(wb, '3D_Stall_Layout_Template.xlsx');
  }
}

/** Lowercase and strip whitespace/underscores/hyphens. `App.js:534`. */
export function norm(x: unknown): string {
  return String(x ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** Read the first row key that normalizes to one of `names`. `App.js:537`. */
export function get(r: SheetRow, names: string[]): unknown {
  const wanted = names.map(norm);
  const k = Object.keys(r).find(key => wanted.includes(norm(key)));
  return k === undefined ? '' : r[k];
}
