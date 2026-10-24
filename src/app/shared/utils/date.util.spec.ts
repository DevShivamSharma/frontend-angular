import { fromIsoDate, toIsoDate } from './date.util';

describe('date util', () => {
  it('should write a date in the local day, not shifted by the time zone', () => {
    expect(toIsoDate(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
    expect(toIsoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('should read a date, or the date part of a date-time', () => {
    expect(fromIsoDate('2026-11-05')).toEqual(new Date(2026, 10, 5));
    expect(fromIsoDate('2026-11-05T05:30:00.000Z')).toEqual(new Date(2026, 10, 5));
  });

  it('should return null for what is not a date', () => {
    expect(fromIsoDate(null)).toBeNull();
    expect(fromIsoDate('soon')).toBeNull();
    expect(fromIsoDate('2026-02-31')).toBeNull();
  });
});
