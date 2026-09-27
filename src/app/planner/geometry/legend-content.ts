import { HallLegend } from '../models/hall.model';

/** One run of legend text, with the only formatting the SelfCare legend markup uses. */
export interface LegendRun {
  text: string;
  underline: boolean;
}

/** A legend row ready for the template: a checked swatch colour OR text runs, never markup. */
export interface LegendEntry {
  label: string;
  swatch: string | null;
  runs: LegendRun[];
}

/**
 * The legend rows the planner shows. The planner is SelfCare's VIEW mode, so a row flagged
 * `visibleInViewMode: false` is left out. `visibleInBookMode` concerns the booking screen and is
 * kept only as data.
 */
export function legendEntries(legends: readonly HallLegend[] | null | undefined): LegendEntry[] {
  return (legends ?? [])
    .filter((l) => l && l.visibleInViewMode !== false && String(l.label ?? '').trim())
    .map((l) => ({
      label: String(l.label).trim(),
      swatch: safeColor(l.colorCode),
      runs: l.colorCode ? [] : legendRuns(l.htmlContent),
    }));
}

/**
 * SelfCare `htmlContent` (e.g. `<p class="…"><span class="text-decoration-underline">09</span>01:</p>`)
 * reduced to plain text runs.
 *
 * The markup is untrusted API data, so it is never bound as HTML — not even through Angular's
 * sanitiser. It is parsed into an inert document (DOMParser runs no script and loads nothing),
 * only its text is kept, and underline — the one formatting the legend relies on ("the
 * UNDERLINED digits are the hall number") — is carried as a flag the template renders itself.
 */
export function legendRuns(html: string | null | undefined): LegendRun[] {
  const source = String(html ?? '');
  if (!source.trim()) return [];

  const doc = new DOMParser().parseFromString(source, 'text/html');
  const runs: LegendRun[] = [];
  const walk = (node: Node, underline: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (!text) return;
      const last = runs[runs.length - 1];
      if (last && last.underline === underline) last.text += text;
      else runs.push({ text, underline });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'template') return;
    const u = underline || tag === 'u' || element.classList.contains('text-decoration-underline');
    element.childNodes.forEach((child) => walk(child, u));
  };
  doc.body.childNodes.forEach((child) => walk(child, false));

  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  }
  return runs.filter((r) => r.text);
}

/** A CSS colour the swatch may use: a hex code or a plain colour name. Anything else: none. */
export function safeColor(color: string | null | undefined): string | null {
  const c = String(color ?? '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) ||
    /^[a-z]{3,30}$/i.test(c)
    ? c
    : null;
}
