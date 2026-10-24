import { describeHall, describeValue, humanize } from './hall-fields';

describe('hall fields', () => {
  it('should turn a field name into words', () => {
    expect(humanize('hallAreaCapacity')).toBe('Hall area capacity');
    expect(humanize('is_vip_lounge')).toBe('Is vip lounge');
    expect(humanize('isAvailableForFnB')).toBe('Is available for fn b');
  });

  it('should read flags as yes or no, lists by their length and nested objects by their name', () => {
    expect(describeValue('isActive', true)).toBe('Yes');
    expect(describeValue('isActive', false)).toBe('No');
    expect(describeValue('imageHall', [1, 2])).toBe('2 items');
    expect(describeValue('hallCategory', { id: 1, categoryName: 'NTA' })).toBe('NTA');
  });

  it('should leave out what has no value, the name and the id', () => {
    const fields = describeHall({
      id: 1,
      name: 'Hall 1',
      description: null,
      hallProfile: '',
      sortOrder: 3,
      isActive: true,
    });

    expect(fields).toEqual([
      { label: 'Sort order', value: '3' },
      { label: 'Is active', value: 'Yes' },
    ]);
  });
});
