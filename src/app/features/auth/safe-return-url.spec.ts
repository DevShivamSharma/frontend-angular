import { safeReturnUrl } from './safe-return-url';

describe('safeReturnUrl', () => {
  it('keeps a path inside the same area', () => {
    expect(safeReturnUrl('/itpo/team', '/itpo')).toBe('/itpo/team');
  });

  it('refuses other organisations, other sites and protocol-relative URLs', () => {
    expect(safeReturnUrl('/yashobhoomi/team', '/itpo')).toBe('/itpo');
    expect(safeReturnUrl('https://evil.example', '/itpo')).toBe('/itpo');
    expect(safeReturnUrl('//evil.example', '/')).toBe('/');
    expect(safeReturnUrl(null, '/admin')).toBe('/admin');
  });
});
