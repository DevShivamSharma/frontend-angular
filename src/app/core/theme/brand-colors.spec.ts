import { brandColorVariables } from './material-theme';

describe('brandColorVariables', () => {
  it('produces every Material system colour as a light-dark pair', () => {
    const variables = brandColorVariables('#0b5394', null);

    expect(Object.keys(variables)).toContain('--mat-sys-primary');
    expect(Object.keys(variables)).toContain('--mat-sys-surface-container-high');
    for (const value of Object.values(variables)) {
      expect(value).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    }
  });

  it('keeps a deep brand colour deep in light mode', () => {
    const primary = brandColorVariables('#0b5394', null)['--mat-sys-primary'];
    const light = primary.slice('light-dark('.length, 'light-dark('.length + 7);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(light.slice(i, i + 2), 16));

    expect(b).toBeGreaterThan(r);
    expect(r + g + b).toBeLessThan(3 * 128);
  });

  it('uses an accent colour for the tertiary palette', () => {
    const plain = brandColorVariables('#0b5394', null)['--mat-sys-tertiary'];
    const accented = brandColorVariables('#0b5394', '#e07a1f')['--mat-sys-tertiary'];

    expect(accented).not.toEqual(plain);
  });
});
