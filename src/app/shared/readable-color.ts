/**
 * Black or white, whichever reads better on `hex`, by WCAG relative luminance. Used where a
 * colour is data (an organisation's brand colour) rather than a theme token.
 */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    return '#ffffff';
  }
  const channel = (offset: number) => {
    const value = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // Contrast against white vs black; pick the larger.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#000000';
}
