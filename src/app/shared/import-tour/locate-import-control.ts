/** Help navigation only; review values stay under the user's control. */
export function locateImportControl(root: HTMLElement, topic: string): boolean {
  const target = root.querySelector<HTMLElement>(`[data-import-guide="${topic}"]`);
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    target.animate(
      [
        { outline: '3px solid #b85b00', outlineOffset: '4px' },
        { outline: '3px solid transparent', outlineOffset: '4px' },
      ],
      { duration: 3500 },
    );
  return true;
}
