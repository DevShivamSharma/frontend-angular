import { statusSeverity } from './event-status';

describe('statusSeverity', () => {
  it('should colour the common statuses, whatever their case', () => {
    expect(statusSeverity('Approved')).toBe('success');
    expect(statusSeverity('PENDING')).toBe('warn');
    expect(statusSeverity('Cancelled')).toBe('danger');
    expect(statusSeverity('Draft')).toBe('info');
  });

  it('should leave an unknown or missing status neutral', () => {
    expect(statusSeverity('Whatever')).toBe('secondary');
    expect(statusSeverity(null)).toBe('secondary');
  });
});
