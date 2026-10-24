/** Text written as HTML (ITPO keeps some descriptions that way), as plain text with its line breaks. */
export function plainText(html: string | null | undefined): string {
  if (!html) {
    return '';
  }
  return html
    .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
