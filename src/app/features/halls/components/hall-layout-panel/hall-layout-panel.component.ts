import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { ItpoLayoutApiService } from '../../data/itpo-layout-api.service';
import {
  GROW_END,
  GrowFrom,
  HallLayout,
  isHorizontal,
  isLine,
  isPillar,
  LayoutArea,
  lineAt,
  lineLength,
  MAX_GRID,
  moveLine,
  PILLAR_SIZES,
  removeLine,
  resizeLayout,
  setLine,
  togglePillar,
} from '../../domain/hall-layout';
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
  NO_NOTES,
  notesProblem,
  sameNotes,
} from '../../domain/hall-notes';
import { LayoutCanvasComponent } from '../layout-canvas/layout-canvas.component';

/**
 * A hall's layout: shown as it is, and (for ITPO staff) edited: pillars put where they stand, the
 * grid made bigger or smaller, and the helpers, text labels and legend ITPO shows on it. Saved to ITPO's layout of the hall, which events read when they
 * add the hall; an event that already has the hall keeps the layout it was given.
 */
@Component({
  selector: 'app-hall-layout-panel',
  imports: [
    FormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    SkeletonModule,
    ToggleSwitchModule,
    EmptyStateComponent,
    LayoutCanvasComponent,
  ],
  templateUrl: './hall-layout-panel.component.html',
  styleUrl: './hall-layout-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallLayoutPanelComponent implements OnInit {
  readonly hallId = input.required<number>();
  readonly hallName = input.required<string>();

  private readonly api = inject(ItpoLayoutApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly layout = signal<HallLayout | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal(false);

  // The edit in progress.
  protected readonly editing = signal(false);
  protected readonly columns = signal(1);
  protected readonly rows = signal(1);
  protected readonly areas = signal<LayoutArea[]>([]);
  protected readonly pillarSize = signal<number>(1);
  protected readonly tool = signal<LayoutTool>('pillar');
  /** The helpers, text labels and legend being edited. */
  protected readonly notes = signal<HallNotes>(NO_NOTES);
  /** The helper or label a click on the layout puts in place. */
  protected readonly picked = signal<{ type: 'helper' | 'label'; index: number } | null>(null);
  protected readonly helperKind = signal(HELPER_KINDS[0].kind);
  protected readonly helperKinds = [...HELPER_KINDS];
  protected readonly maxNotes = MAX_NOTES;
  /** The wall line chosen to be moved: its place in the list of areas. */
  protected readonly selected = signal<number | null>(null);
  /** Which side gets the metres when the grid changes. */
  protected readonly side = signal<GrowFrom>(GROW_END);

  protected readonly toolOptions = [
    { label: 'Pillars', value: 'pillar' },
    { label: 'Wall lines', value: 'wall' },
    { label: 'Helpers & legends', value: 'notes' },
  ];
  protected readonly widthSides = [
    { label: 'Left', value: 'left' },
    { label: 'Right', value: 'right' },
  ];
  protected readonly heightSides = [
    { label: 'Top', value: 'top' },
    { label: 'Bottom', value: 'bottom' },
  ];

  protected readonly maxGrid = MAX_GRID;
  protected readonly sizeOptions = PILLAR_SIZES.map((size) => ({
    label: `${size} m`,
    value: size,
  }));

  /** What is drawn: the draft while editing, else the saved layout. */
  protected readonly shownColumns = computed(() =>
    this.editing() ? this.columns() : (this.layout()?.columns ?? 1),
  );
  protected readonly shownRows = computed(() =>
    this.editing() ? this.rows() : (this.layout()?.rows ?? 1),
  );
  protected readonly shownAreas = computed(() =>
    this.editing() ? this.areas() : (this.layout()?.areas ?? []),
  );
  protected readonly selectedLine = computed(() => {
    const index = this.selected();
    const area = index === null ? null : this.areas()[index];
    return area && isLine(area)
      ? {
          x: area.x,
          y: area.y,
          length: lineLength(area),
          direction: isHorizontal(area) ? 'across' : 'up and down',
        }
      : null;
  });
  protected readonly shownNotes = computed(() =>
    this.editing() ? this.notes() : (this.layout()?.notes ?? NO_NOTES),
  );
  /** The hall's own legend rows that are shown (a code row has no colour to draw). */
  protected readonly shownLegend = computed(() =>
    this.shownNotes().legends.filter((l) => l.visible && l.color && l.label.trim()),
  );
  protected readonly pillarCount = computed(() => this.shownAreas().filter(isPillar).length);
  protected readonly notesChanged = computed(() => {
    const layout = this.layout();
    return !!layout && !sameNotes(this.notes(), layout.notes);
  });
  protected readonly notesProblem = computed(() => notesProblem(this.notes()));
  protected readonly changed = computed(() => {
    const layout = this.layout();
    if (!layout) return false;
    return (
      this.columns() !== layout.columns ||
      this.rows() !== layout.rows ||
      JSON.stringify(this.areas()) !== JSON.stringify(layout.areas) ||
      this.notesChanged()
    );
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .layout(this.hallId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (layout) => {
          this.layout.set(layout);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected startEdit(): void {
    const layout = this.layout();
    if (!layout) return;
    this.columns.set(layout.columns);
    this.rows.set(layout.rows);
    this.areas.set(layout.areas.map((area) => ({ ...area })));
    this.notes.set({
      helpers: layout.notes.helpers.map((h) => ({ ...h })),
      labels: layout.notes.labels.map((l) => ({ ...l })),
      legends: layout.notes.legends.map((l) => ({ ...l })),
    });
    this.picked.set(null);
    this.selected.set(null);
    this.tool.set('pillar');
    this.side.set(GROW_END);
    this.editing.set(true);
  }

  protected cancel(): void {
    this.editing.set(false);
  }

  /** A click on the layout: puts or takes away a pillar, chooses the wall line there, or puts the picked helper or label there. */
  protected place(cell: { x: number; y: number }): void {
    if (this.tool() === 'notes') {
      const picked = this.picked();
      const at = { x: cell.x + 0.5, y: cell.y + 0.5 };
      if (picked?.type === 'helper') this.patchHelper(picked.index, at);
      if (picked?.type === 'label') this.patchLabel(picked.index, at);
      this.picked.set(null);
      return;
    }
    if (this.tool() === 'wall') {
      this.selected.set(lineAt(this.areas(), { x: cell.x + 0.5, y: cell.y + 0.5 }, 1.5));
      return;
    }
    this.areas.update((areas) =>
      togglePillar(areas, cell, this.pillarSize(), { columns: this.columns(), rows: this.rows() }),
    );
  }

  protected chooseTool(tool: LayoutTool): void {
    this.tool.set(tool);
    this.selected.set(null);
    this.picked.set(null);
  }

  // --- helpers, text labels and legend ---

  /** The middle of the grid: where a new helper or label starts, picked so the next click places it. */
  private middle(): { x: number; y: number } {
    return { x: Math.round(this.columns() / 2), y: Math.round(this.rows() / 2) };
  }

  protected addHelper(): void {
    this.notes.update((n) => ({
      ...n,
      helpers: [...n.helpers, newHelper(this.helperKind(), this.middle())],
    }));
    this.picked.set({ type: 'helper', index: this.notes().helpers.length - 1 });
  }

  protected addLabel(): void {
    this.notes.update((n) => ({ ...n, labels: [...n.labels, newLabel(this.middle())] }));
    this.picked.set({ type: 'label', index: this.notes().labels.length - 1 });
  }

  protected addLegend(): void {
    this.notes.update((n) => ({ ...n, legends: [...n.legends, newLegend()] }));
  }

  protected patchHelper(index: number, change: Partial<LayoutHelper>): void {
    this.notes.update((n) => ({
      ...n,
      helpers: n.helpers.map((h, i) => (i === index ? { ...h, ...change } : h)),
    }));
  }

  protected patchLabel(index: number, change: Partial<LayoutLabel>): void {
    this.notes.update((n) => ({
      ...n,
      labels: n.labels.map((l, i) => (i === index ? { ...l, ...change } : l)),
    }));
  }

  protected patchLegend(index: number, change: Partial<LayoutLegend>): void {
    this.notes.update((n) => ({
      ...n,
      legends: n.legends.map((l, i) => (i === index ? { ...l, ...change } : l)),
    }));
  }

  protected removeNote(type: 'helper' | 'label' | 'legend', index: number): void {
    const keep = <T>(list: T[]) => list.filter((_, i) => i !== index);
    this.notes.update((n) =>
      type === 'helper'
        ? { ...n, helpers: keep(n.helpers) }
        : type === 'label'
          ? { ...n, labels: keep(n.labels) }
          : { ...n, legends: keep(n.legends) },
    );
    this.picked.set(null);
  }

  /** The next click on the layout puts this helper or label there; a second press cancels. */
  protected pick(type: 'helper' | 'label', index: number): void {
    this.picked.set(this.isPicked(type, index) ? null : { type, index });
  }

  protected isPicked(type: 'helper' | 'label', index: number): boolean {
    const picked = this.picked();
    return picked?.type === type && picked.index === index;
  }

  protected kindLabel(kind: string): string {
    return HELPER_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  }

  protected setSide(change: Partial<GrowFrom>): void {
    this.side.update((side) => ({ ...side, ...change }));
  }

  /** A new grid size; the walls on the chosen side follow it, and the pillars it no longer holds are cut off. */
  protected resize(columns: number | null, rows: number | null): void {
    const next = {
      columns: Math.min(Math.max(Math.round(columns ?? this.columns()), 1), MAX_GRID),
      rows: Math.min(Math.max(Math.round(rows ?? this.rows()), 1), MAX_GRID),
    };
    const from = { columns: this.columns(), rows: this.rows() };
    this.columns.set(next.columns);
    this.rows.set(next.rows);
    this.selected.set(null);
    this.areas.update((areas) => resizeLayout(areas, from, next, this.side()));
  }

  /** The chosen wall line moved or made longer, to the numbers typed. */
  protected changeLine(change: {
    x?: number | null;
    y?: number | null;
    length?: number | null;
  }): void {
    const index = this.selected();
    if (index === null) return;
    const clean = {
      x: change.x ?? undefined,
      y: change.y ?? undefined,
      length: change.length ?? undefined,
    };
    this.areas.update((areas) => setLine(areas, index, clean, this.grid()));
  }

  /** The chosen wall line moved by whole metres. */
  protected nudge(x: number, y: number): void {
    const index = this.selected();
    if (index === null) return;
    this.areas.update((areas) => moveLine(areas, index, { x, y }, this.grid()));
  }

  protected removeSelected(): void {
    const index = this.selected();
    if (index === null) return;
    this.areas.update((areas) => removeLine(areas, index));
    this.selected.set(null);
  }

  private grid(): { columns: number; rows: number } {
    return { columns: this.columns(), rows: this.rows() };
  }

  protected removeAllPillars(): void {
    this.areas.update((areas) => areas.filter((area) => !isPillar(area)));
  }

  protected async save(): Promise<void> {
    const layout = this.layout();
    if (!layout || !this.changed()) return;
    if (this.notesProblem()) {
      this.tool.set('notes');
      this.notifier.warn(this.notesProblem()!);
      return;
    }
    const go = await this.confirm.ask({
      header: 'Save the layout',
      message: `Save the new layout of ${this.hallName()}? Events that add this hall later will use it.`,
      acceptLabel: 'Save',
    });
    if (!go) return;
    const grid = { columns: this.columns(), rows: this.rows() };
    this.saving.set(true);
    const notes = this.notesChanged() ? this.notes() : undefined;
    this.api.save(layout, grid, this.areas(), notes).subscribe({
      next: () => {
        this.layout.set({ ...layout, ...grid, areas: this.areas(), notes: notes ?? layout.notes });
        this.saving.set(false);
        this.editing.set(false);
        this.notifier.success('Layout saved');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifier.fromError(error, 'The layout could not be saved');
      },
    });
  }
}

type LayoutTool = 'pillar' | 'wall' | 'notes';
