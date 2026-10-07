import { SLUG_PATTERN, slugify } from './plan-fields';

describe('slugify', () => {
  it('turns a name into a valid link', () => {
    expect(slugify('Bharat Mandapam (ITPO)')).toBe('bharat-mandapam-itpo');
    expect(slugify('Jio World Convention Centre')).toBe('jio-world-convention-centre');
  });

  it('drops leading digits and accents', () => {
    expect(slugify('2026 Expo Café')).toBe('expo-cafe');
  });

  it('never ends with a hyphen, even when cut at 40 characters', () => {
    const slug = slugify('India International Convention and Expo Centre Dwarka New Delhi');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBeFalse();
    expect(SLUG_PATTERN.test(slug)).toBeTrue();
  });
});
