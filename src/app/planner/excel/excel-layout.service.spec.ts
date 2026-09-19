import { TestBed } from '@angular/core/testing';
import * as XLSX from 'xlsx';

import { ExcelLayoutService, get, norm } from './excel-layout.service';

/** Build an in-memory .xlsx buffer from named sheets of plain rows. */
function workbook(sheets: Record<string, Record<string, unknown>[]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('norm / get', () => {
  it('strips case, whitespace, underscores and hyphens', () => {
    expect(norm('  Stall_Name ')).toBe('stallname');
    expect(norm('X-Pos')).toBe('xpos');
    expect(norm(null)).toBe('');
  });

  it('matches a header regardless of how it is written', () => {
    const row = { ' stall-width ': 12 };
    expect(get(row, ['Stall Width', 'StallWidth', 'Width'])).toBe(12);
  });

  it('returns an empty string when no header matches', () => {
    expect(get({ a: 1 }, ['Width'])).toBe('');
  });
});

describe('ExcelLayoutService.parse', () => {
  let service: ExcelLayoutService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ExcelLayoutService);
  });

  it('reads hall and stalls from a single Layout sheet', () => {
    const buffer = workbook({
      Layout: [
        {
          'Hall Name': 'Imported Expo',
          Shape: 'SQUARE',
          'Hall Width': 40,
          'Hall Length': 40,
          'Stall Name': 'Shop A',
          'Stall Width': 8,
          'Stall Length': 8,
          'Stall Height': 4,
          'X-Pos': -16,
          'Z-Pos': -16,
          Color: '#ff0000',
          'Gate Side': 'left'
        }
      ]
    });

    const result = service.parse(buffer);

    expect(result.hall.name).toBe('Imported Expo');
    expect(result.hall.shape).toBe('SQUARE');
    expect(result.hall.radius).toBe(0);
    expect(String(result.hall.id)).toContain('excel-hall-');

    expect(result.valid.length).toBe(1);
    expect(result.valid[0].name).toBe('Shop A');
    expect(result.valid[0].posX).toBe(-16);
    expect(result.valid[0].color).toBe('#ff0000');
    expect(result.valid[0].gateSide).toBe('LEFT');
    expect(result.valid[0].hallId).toBe(result.hall.id);
  });

  it('prefers dedicated Hall and Stalls sheets', () => {
    const buffer = workbook({
      Halls: [{ Name: 'Round Room', Shape: 'CIRCLE', 'Hall Radius': 20 }],
      Stalls: [
        { 'Shop Name': 'One', Width: 6, Length: 6, X: 0, Z: 0 },
        { 'Shop Name': 'Two', Width: 6, Length: 6, X: 4, Z: 0 }
      ]
    });

    const result = service.parse(buffer);

    expect(result.hall.shape).toBe('CIRCLE');
    expect(result.hall.radius).toBe(20);
    expect(result.hall.width).toBe(0);
    expect(result.hall.length).toBe(0);
    expect(result.valid.map(s => s.name)).toEqual(['One', 'Two']);
  });

  it('gives every id-less row a distinct id', () => {
    const buffer = workbook({
      Halls: [{ Name: 'H', Shape: 'SQUARE', 'Hall Width': 40, 'Hall Length': 40 }],
      Stalls: [
        { Width: 6, Length: 6, X: -10, Z: 0 },
        { Width: 6, Length: 6, X: 10, Z: 0 }
      ]
    });

    const result = service.parse(buffer);
    const ids = result.valid.map(s => String(s.id));

    expect(new Set(ids).size).toBe(2);
    expect(result.valid.map(s => s.name)).toEqual(['Shop 1', 'Shop 2']);
  });

  it('drops stalls that fall outside the hall but keeps overlapping ones', () => {
    const buffer = workbook({
      Halls: [{ Name: 'H', Shape: 'SQUARE', 'Hall Width': 40, 'Hall Length': 40 }],
      Stalls: [
        { Name: 'In', Width: 8, Length: 8, X: 0, Z: 0 },
        { Name: 'AlsoIn', Width: 8, Length: 8, X: 1, Z: 0 },
        { Name: 'Out', Width: 8, Length: 8, X: 100, Z: 0 }
      ]
    });

    const result = service.parse(buffer);

    expect(result.imported.length).toBe(3);
    // Overlap is deliberately not rejected on import, matching React.
    expect(result.valid.map(s => s.name)).toEqual(['In', 'AlsoIn']);
  });

  it('throws when there is no hall row at all', () => {
    const buffer = workbook({ Other: [{ a: 1 }] });

    expect(() => service.parse(buffer)).toThrowError('Hall data not found in Excel.');
  });
});
