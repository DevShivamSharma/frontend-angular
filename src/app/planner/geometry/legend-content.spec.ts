import { legendEntries, legendRuns, safeColor } from './legend-content';

describe('legend content', () => {
  it('keeps the underline of the SelfCare gate-number notes, as text only', () => {
    const runs = legendRuns(
      '<p class="color-dark fw-500 mb-0"><span class="text-decoration-underline">09</span>01:</p>',
    );
    expect(runs).toEqual([
      { text: '09', underline: true },
      { text: '01:', underline: false },
    ]);
  });

  it('drops scripts, handlers and markup from untrusted content', () => {
    const runs = legendRuns('<img src=x onerror="alert(1)"><script>alert(2)</script><b>E</b>:');
    expect(runs).toEqual([{ text: 'E:', underline: false }]);
  });

  it('hides rows flagged visibleInViewMode: false, and keeps book-mode-only flags as data', () => {
    const entries = legendEntries([
      { label: 'Compulsory passage', colorCode: 'red' },
      { label: 'Hidden in view', colorCode: 'blue', visibleInViewMode: false },
      { label: 'Toilet', htmlContent: '<p>T:</p>', visibleInBookMode: false },
    ]);
    expect(entries.map((e) => e.label)).toEqual(['Compulsory passage', 'Toilet']);
    expect(entries[0].swatch).toBe('red');
    expect(entries[1].runs).toEqual([{ text: 'T:', underline: false }]);
  });

  it('only lets plain colours into a swatch', () => {
    expect(safeColor('#8A2BE2')).toBe('#8A2BE2');
    expect(safeColor('saddlebrown')).toBe('saddlebrown');
    expect(safeColor('red;background:url(x)')).toBeNull();
    expect(safeColor('url(javascript:1)')).toBeNull();
  });
});
