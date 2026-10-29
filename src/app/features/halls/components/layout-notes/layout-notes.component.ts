import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { HallNotes, NO_NOTES } from '../../domain/hall-notes';

/** Which note, and where: a helper's or a label's place in its list. */
export interface NoteRef {
  type: 'helper' | 'label';
  index: number;
}

export interface NoteMove extends NoteRef {
  x: number;
  y: number;
}

/** Positions snap to half a metre, so what is dragged lands where ITPO's own pixels can say. */
const STEP = 0.5;
const KEY_STEP = 0.5;

/** The colour of a helper's icon, as SelfCare draws it. */
const ICON_COLOR: Record<string, string> = {
  'toilet-male': '#80adef',
  'toilet-female': '#ee71ec',
  stairs: '#ff9652',
  'drinking-water': '#383b99',
  'emergency-exit': '#10c83d',
  'emergency-exit-left': '#10c83d',
  'emergency-exit-right': '#10c83d',
  'entry-up': '#353535',
  'entry-left': '#353535',
  'entry-right': '#353535',
};

/** Which picture a kind of helper is drawn with. */
export type Glyph = 'male' | 'female' | 'stairs' | 'water' | 'exit' | 'entry' | 'info' | 'help';

const GLYPH: Record<string, Glyph> = {
  'toilet-male': 'male',
  'toilet-female': 'female',
  stairs: 'stairs',
  'drinking-water': 'water',
  'emergency-exit': 'exit',
  'emergency-exit-left': 'exit',
  'emergency-exit-right': 'exit',
  'entry-up': 'entry',
  'entry-left': 'entry',
  'entry-right': 'entry',
  help: 'help',
};

/** How far a kind of helper's picture is turned, in degrees, and whether it is flipped. */
const TURN: Record<string, number> = { 'entry-left': -90, 'entry-right': 90 };
const FLIP = new Set(['emergency-exit-left']);

const snap = (value: number): number => Math.round(value / STEP) * STEP;

/**
 * The helpers (an icon with its caption) and the text labels of a hall's layout, drawn inside
 * an SVG whose units are metres. A helper stands where ITPO puts it: its top-left corner at the
 * position, the icon as wide as `size` metres, the caption under it. When `draggable`, a note is
 * chosen by pressing it and moved by dragging or with the arrow keys.
 */
@Component({
  // An attribute on an SVG `g`, so it draws into the canvas it is placed in.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'g[app-layout-notes]',
  templateUrl: './layout-notes.component.html',
  styleUrl: './layout-notes.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutNotesComponent {
  readonly notes = input<HallNotes>(NO_NOTES);
  /** The icon's side, in metres: ITPO's own are 2 m, more on a very big hall so they stay readable. */
  readonly size = input(2);
  readonly draggable = input(false);
  /** The note chosen, drawn with a ring round it. */
  readonly chosen = input<NoteRef | null>(null);

  readonly choose = output<NoteRef>();
  readonly moved = output<NoteMove>();

  protected readonly dragging = signal<NoteRef | null>(null);
  private grab: { dx: number; dy: number } | null = null;

  protected readonly caption = computed(() => this.size() * 0.4);
  protected readonly labelSize = computed(() => this.size() * 0.55);

  protected colour(kind: string): string {
    return ICON_COLOR[kind] ?? '#53849d';
  }

  protected glyph(kind: string): Glyph {
    return GLYPH[kind] ?? 'info';
  }

  /** The picture sits in a 64-unit box, turned or flipped for the left and right kinds. */
  protected glyphTransform(kind: string): string {
    const scale = this.size() / 64;
    const turn = TURN[kind] ?? 0;
    const flip = FLIP.has(kind) ? ' scale(-1 1)' : '';
    return `scale(${scale}) translate(32 32) rotate(${turn})${flip}`;
  }

  /** The caption's room, for the area a press lands on: its letters at a rough width each. */
  protected width(label: string): number {
    return Math.max(this.size(), label.length * this.caption() * 0.62);
  }

  protected isChosen(type: NoteRef['type'], index: number): boolean {
    const chosen = this.chosen();
    return chosen?.type === type && chosen.index === index;
  }

  protected press(event: PointerEvent, type: NoteRef['type'], index: number, x: number, y: number) {
    if (!this.draggable() || event.button !== 0) return;
    const at = this.at(event);
    if (!at) return;
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.grab = { dx: x - at.x, dy: y - at.y };
    this.dragging.set({ type, index });
    this.choose.emit({ type, index });
  }

  protected drag(event: PointerEvent, type: NoteRef['type'], index: number) {
    const dragging = this.dragging();
    if (!this.grab || dragging?.type !== type || dragging.index !== index) return;
    const at = this.at(event);
    if (!at) return;
    this.moved.emit({ type, index, x: snap(at.x + this.grab.dx), y: snap(at.y + this.grab.dy) });
  }

  protected release() {
    this.grab = null;
    this.dragging.set(null);
  }

  /** A press that ended a drag must not also count as a click on the canvas behind. */
  protected swallow(event: MouseEvent) {
    if (this.draggable()) event.stopPropagation();
  }

  protected key(event: KeyboardEvent, type: NoteRef['type'], index: number, x: number, y: number) {
    if (!this.draggable()) return;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const by = move[event.key];
    if (!by) return;
    event.preventDefault();
    this.choose.emit({ type, index });
    this.moved.emit({ type, index, x: x + by[0], y: y + by[1] });
  }

  /** The pointer in the SVG's own units (metres), however the SVG is scaled. */
  private at(event: PointerEvent): { x: number; y: number } | null {
    const svg = (event.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
}
