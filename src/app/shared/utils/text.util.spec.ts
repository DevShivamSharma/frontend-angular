import { plainText } from './text.util';

describe('plainText', () => {
  it('should take the tags out and keep the paragraphs apart', () => {
    expect(plainText('<p>Water &amp; Waste</p><p>Reuse</p>')).toBe('Water & Waste\nReuse');
  });

  it('should answer an empty text for nothing', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
  });
});
