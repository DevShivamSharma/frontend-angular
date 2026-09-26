/**
 * Sizes and layout of the annotations SelfCare draws on a hall plan — the icon cards
 * (`helper_text`), the gate / foyer captions (`exit_labels`) and the north arrow — in metres.
 *
 * SelfCare positions these in canvas pixels at 20 px per metre (see `PX_PER_METRE` in
 * selfcare-layout.ts). The sizes below were measured on the reference plan of Hall 14GF, against
 * its own 1 m grid: an icon is ~1.9 m across, a caption has a ~0.55 m cap height (a 0.75 m font),
 * a two-icon card is ~16 x 4.3 m. They are plan-scale on purpose: the planner draws the plan the
 * way SelfCare does, so annotations keep their size relative to the hall at every zoom.
 */

/** Side of one icon on a card. */
export const ICON_SIZE = 1.9;
/** Font size of an icon caption. SelfCare shows captions upper-case. */
export const CAPTION_FONT = 0.75;
/** Font size of a gate / foyer caption (`exit_labels`). */
export const EXIT_LABEL_FONT = 0.75;
/** Font size of the compass letter. */
export const COMPASS_LABEL_FONT = 1.1;
/** Padding inside an icon card. */
export const CARD_PADDING = 0.6;
/** Between an icon and its caption. */
export const ICON_CAPTION_GAP = 0.35;
/** Between two neighbouring slots of one card. */
export const SLOT_GAP = 0.8;

/**
 * Width of a text in metres at a font size, for an upper-case caption. 0.65 em per character
 * reproduces the measured card: "EMERGENCY EXIT" is ~6.9 m at 0.75 m on the reference plan. The
 * renderer passes real canvas measurements instead; this estimate keeps the pure layout (and
 * therefore every stored icon position) deterministic.
 */
export function estimateTextWidth(text: string, font: number): number {
  return text.length * font * 0.65;
}

export interface CardSlot {
  /** Centre of the icon, relative to the card's top-left corner. */
  iconX: number;
  iconZ: number;
  /** Top of the caption, relative to the card's top-left corner. Centred on `iconX`. */
  captionTop: number;
  width: number;
}

export interface CardLayout {
  width: number;
  height: number;
  slots: CardSlot[];
}

/**
 * One `helper_text` entry laid out the way SelfCare lays it out: a white card whose top-left is
 * the entry's position, holding a row of slots, each an icon above its caption.
 */
export function cardLayout(
  captions: readonly string[],
  textWidth: (text: string, font: number) => number = estimateTextWidth,
): CardLayout {
  const slots: CardSlot[] = [];
  let x = CARD_PADDING;

  captions.forEach((caption, i) => {
    const width = Math.max(ICON_SIZE, textWidth(caption.toUpperCase(), CAPTION_FONT));
    if (i > 0) x += SLOT_GAP;
    slots.push({
      iconX: x + width / 2,
      iconZ: CARD_PADDING + ICON_SIZE / 2,
      captionTop: CARD_PADDING + ICON_SIZE + ICON_CAPTION_GAP,
      width,
    });
    x += width;
  });

  return {
    width: x + CARD_PADDING,
    height: CARD_PADDING + ICON_SIZE + ICON_CAPTION_GAP + CAPTION_FONT + CARD_PADDING,
    slots,
  };
}

/** One card of icons: its top-left corner and its icons in row order. */
export interface PlanCard<T> {
  anchor: { x: number; z: number };
  items: T[];
}

/** Spacing the old seed data spread one row's icons by (build-demo-hall-shapes, before anchors). */
const LEGACY_SPACING = 5;

/**
 * Icons grouped into the cards SelfCare draws.
 *
 * - Icons with an `anchor` (current data) group by it, ordered by `slot`.
 * - Icons without one come from the older seed data, which spread each `helper_text` row
 *   5 m apart AROUND the SelfCare position — and that position is the card's top-left. So a run
 *   of anchorless icons on one line, 5 m (or a multiple, where an icon of an unsupported kind was
 *   dropped) apart, is one card whose anchor is the run's centre.
 */
export function planCards<
  T extends {
    position: { x: number; z: number };
    anchor?: { x: number; z: number } | null;
    slot?: number | null;
  },
>(amenities: readonly T[]): PlanCard<T>[] {
  const anchored = new Map<string, PlanCard<T>>();
  const loose: T[] = [];
  for (const a of amenities) {
    if (!Number.isFinite(a?.position?.x) || !Number.isFinite(a?.position?.z)) continue;
    const anchor =
      a.anchor && Number.isFinite(a.anchor.x) && Number.isFinite(a.anchor.z) ? a.anchor : null;
    if (!anchor) {
      loose.push(a);
      continue;
    }
    const key = `${anchor.x.toFixed(4)},${anchor.z.toFixed(4)}`;
    const card = anchored.get(key) ?? { anchor, items: [] };
    card.items.push(a);
    anchored.set(key, card);
  }
  for (const card of anchored.values()) card.items.sort((p, q) => (p.slot ?? 0) - (q.slot ?? 0));

  const legacy: PlanCard<T>[] = [];
  const sorted = [...loose].sort(
    (p, q) => p.position.z - q.position.z || p.position.x - q.position.x,
  );
  let run: T[] = [];
  const flush = (): void => {
    if (!run.length) return;
    const x = (run[0].position.x + run[run.length - 1].position.x) / 2;
    legacy.push({ anchor: { x, z: run[0].position.z }, items: run });
    run = [];
  };
  for (const a of sorted) {
    const last = run[run.length - 1];
    const gap = last ? a.position.x - last.position.x : NaN;
    const sameRow =
      !!last &&
      Math.abs(a.position.z - last.position.z) < 1e-6 &&
      gap > 0 &&
      gap <= LEGACY_SPACING * 3 + 1e-6 &&
      Math.abs(gap / LEGACY_SPACING - Math.round(gap / LEGACY_SPACING)) < 1e-6;
    if (!sameRow) flush();
    run.push(a);
  }
  flush();

  return [...anchored.values(), ...legacy];
}
