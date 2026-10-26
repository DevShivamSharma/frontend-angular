import { categoryGroups, slugOf } from './category-groups';

describe('category groups', () => {
  it('should keep the groups of categories and leave ITPO’s other lists out, by name', () => {
    const groups = categoryGroups([
      { id: 1, name: 'roles', slug: 'role', description: null, active: true },
      {
        id: 14,
        name: 'INDIA INTERNATIONAL TRADE FAIR',
        slug: 'india_international_trade_fair',
        description: null,
        active: true,
      },
      { id: 7, name: 'State', slug: 'state', description: null, active: true },
      { id: 13, name: 'AAHAR', slug: 'aahar', description: null, active: true },
      { id: 18, name: 'FnB', slug: 'f&b', description: null, active: true },
    ]);

    expect(groups.map((g) => g.name)).toEqual(['AAHAR', 'FnB', 'INDIA INTERNATIONAL TRADE FAIR']);
  });
});

describe('slugOf', () => {
  it('should make a slug of the name', () => {
    expect(slugOf('Start-Ups AAHAR - Hospitality, Decor')).toBe(
      'start-ups-aahar-hospitality-decor',
    );
    expect(slugOf('Food & Beverage')).toBe('food-and-beverage');
    expect(slugOf('  Café  ')).toBe('cafe');
  });

  it('should keep a slug within the 100 characters ITPO takes, and never end on a dash', () => {
    const slug = slugOf(`${'word '.repeat(40)}end`);

    expect(slug.length).toBeLessThanOrEqual(100);
    expect(slug.endsWith('-')).toBe(false);
  });
});
