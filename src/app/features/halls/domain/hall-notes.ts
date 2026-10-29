/**
 * What ITPO shows on a hall's layout besides its grid: helpers (a toilet, the stairs, an exit: an
 * icon with a caption), text labels, and the legend that says what each colour means. ITPO keeps
 * them in the layout row's `helper_text`, `exit_labels` and `legends` (`T_HALL_LAYOUTS`); a
 * position is canvas pixels at 20 px per metre from the grid's top-left, and may lie outside the
 * grid (a sign beside a wall). Whatever ITPO stores that this portal does not edit is kept as it was.
 */
export const PX_PER_METRE = 20;

/**
 * The helpers this portal offers: SelfCare and the booking portal draw a helper's icon from their
 * own `assets/images/<kind>.svg`, so only the kinds they have are offered.
 */
export const HELPER_KINDS: readonly { kind: string; label: string }[] = [
  { kind: 'toilet-male', label: 'Toilet (Male)' },
  { kind: 'toilet-female', label: 'Toilet (Female)' },
  { kind: 'stairs', label: 'Stairs' },
  { kind: 'drinking-water', label: 'Drinking water' },
  { kind: 'emergency-exit', label: 'Emergency exit' },
  { kind: 'emergency-exit-left', label: 'Emergency exit (left)' },
  { kind: 'emergency-exit-right', label: 'Emergency exit (right)' },
  { kind: 'entry-up', label: 'Entry' },
  { kind: 'entry-left', label: 'Entry (left)' },
  { kind: 'entry-right', label: 'Entry (right)' },
  { kind: 'info', label: 'Information' },
  { kind: 'help', label: 'Help' },
];

/** An icon with its caption, at a place in metres. A group of several icons keeps the others as they were. */
export interface LayoutHelper {
  x: number;
  y: number;
  kind: string;
  label: string;
  raw: Record<string, unknown>;
}

export interface LayoutLabel {
  text: string;
  x: number;
  y: number;
  raw: Record<string, unknown>;
}

/** A legend row: a colour and what it means; a row without a colour explains a code instead. */
export interface LayoutLegend {
  label: string;
  color: string | null;
  visible: boolean;
  raw: Record<string, unknown>;
}

export interface HallNotes {
  helpers: LayoutHelper[];
  labels: LayoutLabel[];
  legends: LayoutLegend[];
}

export const NO_NOTES: HallNotes = { helpers: [], labels: [], legends: [] };

/** The most of each kind a layout may have, as the planner reads them. */
export const MAX_NOTES = 200;

const LEGEND_COLOR = '#53849d';

/** The helpers, labels and legend of ITPO's layout row (its JSON columns may come as text). */
export function readNotes(row: Record<string, unknown>): HallNotes {
  return {
    helpers: rows(row['helper_text'] ?? row['helperText']).flatMap((raw) => {
      const x = num(raw['positionX']);
      const y = num(raw['positionY']);
      const image = rows(raw['image'])[0];
      const kind = image ? kindOf(image['url']) : null;
      if (x === null || y === null || !image || !kind) return [];
      const label = typeof image['label'] === 'string' ? image['label'] : '';
      return [{ x: metres(x), y: metres(y), kind, label, raw }];
    }),
    labels: rows(row['exit_labels'] ?? row['exitLabels']).flatMap((raw) => {
      const x = num(raw['positionX']);
      const y = num(raw['positionY']);
      const text = typeof raw['text'] === 'string' ? raw['text'] : '';
      return x === null || y === null ? [] : [{ text, x: metres(x), y: metres(y), raw }];
    }),
    legends: rows(row['legends']).map((raw) => ({
      label: typeof raw['label'] === 'string' ? raw['label'] : '',
      color: typeof raw['colorCode'] === 'string' ? raw['colorCode'] : null,
      // Colour rows say `visibleInViewMode`, code rows `visibleInBookMode`; either hides the row.
      visible: raw['visibleInViewMode'] !== false && raw['visibleInBookMode'] !== false,
      raw,
    })),
  };
}

/** The three columns as ITPO stores them: what was there, with this portal's changes on top. */
export function toNotesFields(notes: HallNotes): {
  helper_text: Record<string, unknown>[];
  exit_labels: Record<string, unknown>[];
  legends: Record<string, unknown>[];
} {
  return {
    helper_text: notes.helpers.map((h) => {
      const [first, ...others] = rows(h.raw['image']);
      return {
        ...h.raw,
        positionX: pixels(h.x),
        positionY: pixels(h.y),
        image: [
          {
            width: 40,
            height: 40,
            ...first,
            url: `assets/images/${h.kind}.svg`,
            label: h.label.trim(),
          },
          ...others,
        ],
      };
    }),
    exit_labels: notes.labels.map((l) => ({
      ...l.raw,
      text: l.text.trim(),
      positionX: pixels(l.x),
      positionY: pixels(l.y),
    })),
    legends: notes.legends.map((l) =>
      l.color === null
        ? { ...l.raw, label: l.label.trim(), visibleInBookMode: l.visible }
        : { ...l.raw, label: l.label.trim(), colorCode: l.color, visibleInViewMode: l.visible },
    ),
  };
}

/** The notes of a hall being created, as the create-hall call takes them. */
export interface NotesPayload {
  helpers?: { kind: string; label: string; x: number; y: number }[];
  labels?: { text: string; x: number; y: number }[];
  legends?: { label: string; color: string; visible: boolean }[];
}

/**
 * The notes of a new hall for the create-hall call: each kind only when it has entries, and none
 * at all (undefined) when the hall has no notes, so a hall without them is made as it always was.
 */
export function toNotesPayload(notes: HallNotes): NotesPayload | undefined {
  const payload: NotesPayload = {};
  if (notes.helpers.length) {
    payload.helpers = notes.helpers.map((h) => ({
      kind: h.kind,
      label: h.label.trim(),
      x: h.x,
      y: h.y,
    }));
  }
  if (notes.labels.length) {
    payload.labels = notes.labels.map((l) => ({ text: l.text.trim(), x: l.x, y: l.y }));
  }
  const legends = notes.legends.filter((l) => l.color !== null);
  if (legends.length) {
    payload.legends = legends.map((l) => ({
      label: l.label.trim(),
      color: l.color as string,
      visible: l.visible,
    }));
  }
  return Object.keys(payload).length ? payload : undefined;
}

/** Why the notes cannot be saved, in words; null when they can. */
export function notesProblem(notes: HallNotes): string | null {
  if (notes.helpers.some((h) => !h.label.trim())) return 'Give every helper a caption.';
  if (notes.labels.some((l) => !l.text.trim())) return 'Give every text label its words.';
  if (notes.legends.some((l) => !l.label.trim())) return 'Say what every legend row means.';
  return null;
}

export const sameNotes = (a: HallNotes, b: HallNotes): boolean =>
  JSON.stringify(toNotesFields(a)) === JSON.stringify(toNotesFields(b));

export function newHelper(kind: string, at: { x: number; y: number }): LayoutHelper {
  const label = HELPER_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  return { kind, label, x: at.x, y: at.y, raw: {} };
}

export const newLabel = (at: { x: number; y: number }): LayoutLabel => ({
  text: 'Label',
  x: at.x,
  y: at.y,
  raw: {},
});

export const newLegend = (): LayoutLegend => ({
  label: '',
  color: LEGEND_COLOR,
  visible: true,
  raw: {},
});

// --- reading helpers ---------------------------------------------------------------------------

/** A JSON column as a list of objects, whether ITPO sent it parsed or as text. */
function rows(value: unknown): Record<string, unknown>[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    : [];
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** `assets/images/toilet-male.svg` -> `toilet-male`; anything else is not an icon. */
function kindOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const name = url
    .split('/')
    .pop()
    ?.replace(/\.svg$/i, '')
    .toLowerCase();
  return name && /^[a-z0-9][a-z0-9-]{0,40}$/.test(name) ? name : null;
}

const metres = (px: number) => Math.round((px / PX_PER_METRE) * 10) / 10;
const pixels = (m: number) => Math.round(m * PX_PER_METRE);
