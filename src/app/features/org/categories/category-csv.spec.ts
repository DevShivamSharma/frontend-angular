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

  it("reads SelfCare's T_CODE_MASTER export: its stall categories, with their ids", () => {
    const csv = [
      '"id","name","slug","typeId","status","parentId"',
      '1,"Super Admin","system_admin",1,True,0',
      '85,"Processed Food, Organic Food, Beverages, Ingredients, Dairy Products, Spices and Agri Produce","processed_food",13,True,0',
      '105,"Startup- Multi-products',
      '","startups_iitf",14,True,0',
      '118,"F&B Vending Point","f&b_vending",18,False,0',
    ].join('\n');
    const { rows, selfcare, notCategories, error } = readCategoryCsv(csv);
    expect(error).toBeNull();
    expect(selfcare).toBeTrue();
    // The role is no stall category; the stray line break in a name is dropped.
    expect(notCategories).toBe(1);
    expect(importable(rows)).toEqual([
      {
        name: 'Processed Food, Organic Food, Beverages, Ingredients, Dairy Products, Spices and Agri Produce',
        status: 'active',
        itpoId: '85',
      },
      { name: 'Startup- Multi-products', status: 'active', itpoId: '105' },
      { name: 'F&B Vending Point', status: 'inactive', itpoId: '118' },
    ]);
  });

  it('needs a name column', () => {
    expect(readCategoryCsv('title\nPremium').error).toContain('name');
  });
});
