import { importable, readCategoryCsv } from './category-csv';

describe('readCategoryCsv', () => {
  it('reads names and statuses, quoted or not', () => {
    const { rows, error } = readCategoryCsv(
      'name,status\nPremium,active\n"Corner, double",INACTIVE\nF&B,\n',
    );
    expect(error).toBeNull();
    expect(rows.map((r) => [r.name, r.status, r.problem])).toEqual([
      ['Premium', 'active', null],
      ['Corner, double', 'inactive', null],
      ['F&B', 'active', null],
    ]);
  });

  it('skips empty lines, marks repeats, blanks and unknown statuses, and imports only the rest', () => {
    const { rows } = readCategoryCsv('Name,Status\r\nPremium\r\npremium\r\n\r\n,active\r\n');
    expect(rows.map((r) => r.problem)).toEqual([null, 'Twice in the file', 'No name']);
    expect(importable(rows)).toEqual([{ name: 'Premium', status: 'active' }]);
    expect(readCategoryCsv('name,status\nA,maybe').rows[0].problem).toBe(
      'Status is active or inactive',
    );
  });

  it('needs a name column', () => {
    expect(readCategoryCsv('title\nPremium').error).toContain('name');
  });
});
