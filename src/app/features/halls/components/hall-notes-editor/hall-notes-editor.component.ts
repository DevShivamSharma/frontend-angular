import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import {
  HallNotes,
  HELPER_KINDS,
  LayoutHelper,
  LayoutLabel,
  LayoutLegend,
  MAX_NOTES,
  newHelper,
  newLabel,
  newLegend,
  notesProblem,
} from '../../domain/hall-notes';
import { LayoutArea } from '../../domain/hall-layout';
import { Corner } from '../../domain/hall-shape.model';
import { HallCanvasComponent } from '../hall-canvas/hall-canvas.component';
import { LayoutCanvasComponent } from '../layout-canvas/layout-canvas.component';
import { NoteMove, NoteRef } from '../layout-notes/layout-notes.component';

/** How far from the grid's corner a note may be put, in metres (the API's limit too). */
const MAX_DISTANCE = 8000;
/** Positions are kept to half a metre. */
const STEP = 0.5;
/** A helper's icon is 2 m on ITPO's plans; a click puts its middle on the point. */
const HALF_ICON = 1;

const snap = (value: number): number =>
  Math.max(-MAX_DISTANCE, Math.min(MAX_DISTANCE, Math.round(value / STEP) * STEP));

/** What the list shows for a note, and what the form below edits. */
interface Item {
  type: NoteRef['type'];
  index: number;
  text: string;
  x: number;
  y: number;
}

/**
 * A hall's helpers (toilets, stairs, exits), text labels and legend: added, put on the layout
 * (dragged to a place, or by Place on layout and a click, outside the grid too), renamed and
 * removed. The hall is drawn as its outline (a hall being made: `ring`) or as its layout
 * (`columns`, `rows` and `areas`). What is edited is handed back whole in `notesChange`.
 */
@Component({
  selector: 'app-hall-notes-editor',
  imports: [
    FormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    ToggleSwitchModule,
    HallCanvasComponent,
    LayoutCanvasComponent,
  ],
  templateUrl: './hall-notes-editor.component.html',
  styleUrl: './hall-notes-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallNotesEditorComponent {
  readonly notes = input.required<HallNotes>();
  readonly columns = input.required<number>();
  readonly rows = input.required<number>();
  /** A hall being made: its outline. Left out, the hall is drawn from `areas`. */
  readonly ring = input<readonly Corner[] | null>(null);
  readonly areas = input<readonly LayoutArea[]>([]);
  readonly hallName = input('the hall');

  readonly notesChange = output<HallNotes>();

  protected readonly helperKinds = [...HELPER_KINDS];
  protected readonly helperKind = signal(HELPER_KINDS[0].kind);
  protected readonly maxNotes = MAX_NOTES;
  protected readonly maxDistance = MAX_DISTANCE;
  /** The helper or label chosen: the form below edits it, and the next click may place it. */
  protected readonly chosen = signal<NoteRef | null>(null);
  protected readonly placing = signal(false);

  protected readonly items = computed<Item[]>(() => [
    ...this.notes().helpers.map((h, index) => ({
      type: 'helper' as const,
      index,
      text: h.label || this.kindLabel(h.kind),
      x: h.x,
      y: h.y,
    })),
    ...this.notes().labels.map((l, index) => ({
      type: 'label' as const,
      index,
      text: l.text || 'Text label',
      x: l.x,
      y: l.y,
    })),
  ]);

  protected readonly active = computed(() => {
    const chosen = this.chosen();
    return chosen
      ? (this.items().find((i) => i.type === chosen.type && i.index === chosen.index) ?? null)
      : null;
  });

  protected readonly problem = computed(() => notesProblem(this.notes()));

  /** The middle of the grid: where a new helper or label starts. */
  private middle(): { x: number; y: number } {
    return { x: Math.round(this.columns() / 2), y: Math.round(this.rows() / 2) };
  }

  protected kindLabel(kind: string): string {
    return HELPER_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  }

  protected choose(note: NoteRef | null): void {
    this.chosen.set(note);
    this.placing.set(false);
  }

  protected isChosen(item: Item): boolean {
    const chosen = this.chosen();
    return chosen?.type === item.type && chosen.index === item.index;
  }

  protected addHelper(): void {
    const helpers = [...this.notes().helpers, newHelper(this.helperKind(), this.middle())];
    this.notesChange.emit({ ...this.notes(), helpers });
    this.chosen.set({ type: 'helper', index: helpers.length - 1 });
    this.placing.set(true);
  }

  protected addLabel(): void {
    const labels = [...this.notes().labels, newLabel(this.middle())];
    this.notesChange.emit({ ...this.notes(), labels });
    this.chosen.set({ type: 'label', index: labels.length - 1 });
    this.placing.set(true);
  }

  protected addLegend(): void {
    this.notesChange.emit({ ...this.notes(), legends: [...this.notes().legends, newLegend()] });
  }

  protected rename(text: string): void {
    const note = this.chosen();
    if (!note) return;
    if (note.type === 'helper') this.patchHelper(note.index, { label: text });
    else this.patchLabel(note.index, { text });
  }

  /** A position typed or dragged: kept to half a metre and inside the limit. */
  protected moveTo(note: NoteRef, change: { x?: number | null; y?: number | null }): void {
    const current = this.items().find((i) => i.type === note.type && i.index === note.index);
    if (!current) return;
    const at = {
      x: snap(change.x ?? current.x),
      y: snap(change.y ?? current.y),
    };
    if (note.type === 'helper') this.patchHelper(note.index, at);
    else this.patchLabel(note.index, at);
  }

  protected dragged(move: NoteMove): void {
    this.moveTo(move, move);
  }

  /** A click while placing: the middle of a helper's icon, or the start of a label, goes there. */
  protected place(point: { x: number; y: number }): void {
    const note = this.chosen();
    if (!note) return;
    this.moveTo(
      note,
      note.type === 'helper' ? { x: point.x - HALF_ICON, y: point.y - HALF_ICON } : point,
    );
    this.placing.set(false);
  }

  protected remove(): void {
    const note = this.chosen();
    if (!note) return;
    const keep = <T>(list: T[]) => list.filter((_, i) => i !== note.index);
    const notes = this.notes();
    this.notesChange.emit(
      note.type === 'helper'
        ? { ...notes, helpers: keep(notes.helpers) }
        : { ...notes, labels: keep(notes.labels) },
    );
    this.choose(null);
  }

  protected patchLegend(index: number, change: Partial<LayoutLegend>): void {
    this.notesChange.emit({
      ...this.notes(),
      legends: this.notes().legends.map((l, i) => (i === index ? { ...l, ...change } : l)),
    });
  }

  protected removeLegend(index: number): void {
    this.notesChange.emit({
      ...this.notes(),
      legends: this.notes().legends.filter((_, i) => i !== index),
    });
  }

  private patchHelper(index: number, change: Partial<LayoutHelper>): void {
    this.notesChange.emit({
      ...this.notes(),
      helpers: this.notes().helpers.map((h, i) => (i === index ? { ...h, ...change } : h)),
    });
  }

  private patchLabel(index: number, change: Partial<LayoutLabel>): void {
    this.notesChange.emit({
      ...this.notes(),
      labels: this.notes().labels.map((l, i) => (i === index ? { ...l, ...change } : l)),
    });
  }
}
