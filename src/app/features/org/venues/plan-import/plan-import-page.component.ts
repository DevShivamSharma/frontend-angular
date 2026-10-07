import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type {
  DrawingChoices,
  DrawingFloorResult,
  DrawingGroupChoice,
  DrawingJobView,
  DrawingText,
  FloorArea,
  FloorAreaKind,
  HallView,
  PlanTextKind,
  VenueView,
} from '../../../../core/api/api.models';
import { errorMessage } from '../../../../core/api/http-error';
import { OrgContextStore } from '../../../../core/org/org.stores';
import { Notifier } from '../../../../core/ui/notifier.service';
import { VenuesApi } from '../../../../core/venues/venues-api.service';
import {
  AREA_COLORS,
  AREA_LABELS,
  FloorViewComponent,
} from '../../../../shared/floor/floor-view.component';
import { PageHeaderComponent } from '../../../../shared/page-header.component';

type Stage = 'upload' | 'reading' | 'review';

/** Mirrors the server's limit. */
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_INSTRUCTIONS = 1000;
const ACCEPT = '.pdf,.dxf,.png,.jpg,.jpeg,.webp,.tif,.tiff';

/** Kinds a colour on the floor can become, in the order the select lists them. */
const GROUP_CHOICES: Array<{ value: DrawingGroupChoice; label: string }> = [
  { value: 'floor', label: 'Stall floor (no area)' },
  ...(
    [
      'passage',
      'fire_curtain',
      'no_build',
      'column',
      'utility',
      'entry',
      'unavailable',
      'wall',
      'marking',
      'outside',
    ] as FloorAreaKind[]
  ).map((kind) => ({ value: kind as DrawingGroupChoice, label: AREA_LABELS[kind] })),
];

/** Kinds a text can be, grouped for the select. */
const TEXT_KIND_GROUPS: Array<{
  label: string;
  kinds: Array<{ value: PlanTextKind; label: string }>;
}> = [
  { label: 'On the plan', kinds: [{ value: 'label', label: 'Label (gate, room, foyer)' }] },
  {
    label: 'Facility icon',
    kinds: [
      { value: 'icon:toilet-male', label: 'Toilet (male)' },
      { value: 'icon:toilet-female', label: 'Toilet (female)' },
      { value: 'icon:toilet', label: 'Toilet' },
      { value: 'icon:stairs', label: 'Stairs' },
      { value: 'icon:lift', label: 'Lift' },
      { value: 'icon:emergency-exit', label: 'Emergency exit' },
      { value: 'icon:entry', label: 'Entry' },
      { value: 'icon:cargo-truck', label: 'Cargo / service entry' },
      { value: 'icon:drinking-water', label: 'Drinking water' },
      { value: 'icon:circulation', label: 'Circulation area' },
    ],
  },
  {
    label: 'Legend row',
    kinds: (
      [
        'passage',
        'fire_curtain',
        'no_build',
        'column',
        'utility',
        'unavailable',
        'entry',
      ] as FloorAreaKind[]
    ).map((kind) => ({ value: `area:${kind}` as PlanTextKind, label: AREA_LABELS[kind] })),
  },
  {
    label: 'Leave out',
    kinds: [
      { value: 'stall_number', label: 'Stall number' },
      { value: 'dimension', label: 'Dimension' },
      { value: 'title', label: 'Title / note' },
      { value: 'none', label: 'Not a text' },
    ],
  },
];

const FORMAT_LABELS: Record<string, string> = {
  'pdf-scan': 'Scanned PDF',
  'pdf-vector': 'CAD PDF',
  dxf: 'DXF drawing',
  image: 'Image',
};

/**
 * Imports a hall's floor from its plan. The server finds the plan's stall grid: only gridded
 * floor becomes floor, coloured bands on it become areas (named by the plan's own legend when
 * it can), and texts become labels, icons and legend rows. The person checks all of that here
 * before anything is saved.
 */
@Component({
  selector: 'app-plan-import-page',
  imports: [
    DecimalPipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
    FloorViewComponent,
    PageHeaderComponent,
  ],
  templateUrl: './plan-import-page.component.html',
  styleUrl: './plan-import-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanImportPageComponent implements OnInit {
  /** From the route. */
  readonly venueId = input.required<string>();
  /** From the query string: add the plan as a new version of this hall. */
  readonly hallId = input<string>();

  private readonly api = inject(VenuesApi);
  private readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  private readonly context = inject(OrgContextStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly accept = ACCEPT;
  protected readonly maxInstructions = MAX_INSTRUCTIONS;
  protected readonly groupChoices = GROUP_CHOICES;
  protected readonly textKindGroups = TEXT_KIND_GROUPS;
  protected readonly slug = this.context.slug;

  protected readonly venue = signal<VenueView | null>(null);
  protected readonly halls = signal<HallView[]>([]);
  protected readonly stage = signal<Stage>('upload');

  // Upload.
  protected readonly file = signal<File | null>(null);
  protected readonly dragOver = signal(false);
  protected instructions = '';
  protected gridMetres = 1;
  protected readText = true;
  protected readonly uploadError = signal<string | null>(null);

  // Reading.
  protected readonly job = signal<DrawingJobView | null>(null);
  protected readonly elapsed = signal(0);
  private destroyed = false;

  // Review.
  protected readonly plan = signal<DrawingFloorResult | null>(null);
  private readonly choices = signal<Required<DrawingChoices>>({ parts: [], groups: {}, texts: {} });
  protected readonly refreshing = signal(false);
  protected readonly view = signal<'plan' | 'floor'>('plan');
  protected readonly showAllTexts = signal(false);
  protected name = '';
  protected code = '';
  protected level = '';
  protected target = 'new';
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly savedHalls = signal<HallView[]>([]);

  protected readonly result = computed(() => this.job()?.result ?? null);
  protected readonly formatLabel = computed(() => FORMAT_LABELS[this.result()?.format ?? ''] ?? '');
  protected readonly selectedParts = computed(
    () => this.plan()?.parts.filter((p) => p.selected) ?? [],
  );
  protected readonly blockingAreas = computed(
    () => this.plan()?.floor.areas.filter((a) => a.kind !== 'outside') ?? [],
  );
  protected readonly outsideAreas = computed(
    () => this.plan()?.floor.areas.filter((a) => a.kind === 'outside') ?? [],
  );
  protected readonly reviewTexts = computed(() => {
    const texts = this.plan()?.texts ?? [];
    const shown = this.showAllTexts()
      ? texts.filter((t) => t.text.trim().length > 1)
      : texts.filter((t) => t.used || t.review);
    return [...shown].sort((a, b) => Number(b.review) - Number(a.review) || a.index - b.index);
  });
  protected readonly toReview = computed(
    () => this.plan()?.texts.filter((t) => t.review).length ?? 0,
  );
  protected readonly stepLabel = computed(() => {
    const job = this.job();
    if (!job) return 'Uploading the plan…';
    return job.step === 'reading'
      ? 'Finding the stall grid and reading the plan…'
      : 'Working out what each text is, with the local model…';
  });

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [venue, halls] = await Promise.all([
        firstValueFrom(this.api.venue(this.slug(), this.venueId())),
        firstValueFrom(this.api.halls(this.slug(), this.venueId())),
      ]);
      this.venue.set(venue);
      this.halls.set(halls);
      const hallId = this.hallId();
      if (hallId && halls.some((h) => h.id === hallId)) {
        this.target = hallId;
      }
    } catch (error) {
      this.notifier.error(error);
    }
  }

  // ---- upload -----------------------------------------------------------------------------

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.choose(file);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.choose(file);
  }

  private choose(file: File): void {
    this.uploadError.set(null);
    if (file.size > MAX_FILE_BYTES) {
      this.uploadError.set('The plan is larger than 60 MB.');
      return;
    }
    if (/\.dwg$/i.test(file.name)) {
      this.uploadError.set('DWG cannot be read directly: save it as DXF or PDF from AutoCAD.');
      return;
    }
    this.file.set(file);
  }

  protected async start(): Promise<void> {
    const file = this.file();
    if (!file) return;
    this.uploadError.set(null);
    this.stage.set('reading');
    this.job.set(null);
    const started = Date.now();
    const tick = setInterval(
      () => this.elapsed.set(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    try {
      let job = await firstValueFrom(
        this.api.startDrawing(this.slug(), this.venueId(), file, {
          instructions: this.instructions,
          gridMetres: this.gridMetres || 1,
          readText: this.readText,
        }),
      );
      this.job.set(job);
      while (job.status === 'running' && !this.destroyed) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        job = await firstValueFrom(this.api.drawingJob(this.slug(), this.venueId(), job.id));
        this.job.set(job);
      }
      if (job.status === 'failed' || !job.result) {
        this.uploadError.set(job.message ?? 'The plan could not be read.');
        this.stage.set('upload');
        return;
      }
      this.plan.set(job.result.plan);
      this.choices.set({
        parts: job.result.plan.parts.filter((p) => p.selected).map((p) => p.id),
        groups: {},
        texts: {},
      });
      this.name = this.suggestName(job.result.plan.texts, file.name);
      this.stage.set('review');
    } catch (error) {
      this.uploadError.set(errorMessage(error));
      this.stage.set('upload');
    } finally {
      clearInterval(tick);
    }
  }

  /** A hall name from the plan's title ("EXHIBITION HALL 6"), else the file's name. */
  private suggestName(texts: DrawingText[], fileName: string): string {
    const title = texts.find((t) => /\bhall\b/i.test(t.text) && t.text.length <= 60);
    const raw = title?.text ?? fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ');
    return raw
      .toLowerCase()
      .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
      .trim()
      .slice(0, 120);
  }

  protected reset(): void {
    this.stage.set('upload');
    this.plan.set(null);
    this.job.set(null);
    this.savedHalls.set([]);
  }

  // ---- review -----------------------------------------------------------------------------

  protected togglePart(id: number): void {
    this.choices.update((c) => ({
      ...c,
      parts: c.parts.includes(id) ? c.parts.filter((p) => p !== id) : [...c.parts, id],
    }));
    void this.refresh();
  }

  protected setGroup(id: number, choice: DrawingGroupChoice): void {
    this.choices.update((c) => ({ ...c, groups: { ...c.groups, [id]: choice } }));
    void this.refresh();
  }

  protected setText(index: number, kind: PlanTextKind): void {
    this.choices.update((c) => ({ ...c, texts: { ...c.texts, [index]: kind } }));
    void this.refresh();
  }

  private refreshToken = 0;

  /** Asks the server for the floor these choices make; only the latest answer is shown. */
  private async refresh(): Promise<void> {
    const job = this.job();
    if (!job) return;
    const token = ++this.refreshToken;
    this.refreshing.set(true);
    try {
      const plan = await firstValueFrom(
        this.api.drawingFloor(this.slug(), this.venueId(), job.id, this.choices()),
      );
      if (token === this.refreshToken) this.plan.set(plan);
    } catch (error) {
      if (token === this.refreshToken) this.notifier.error(error);
    } finally {
      if (token === this.refreshToken) this.refreshing.set(false);
    }
  }

  protected async save(another: boolean): Promise<void> {
    const job = this.job();
    if (!job || !this.name.trim() || !this.selectedParts().length) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const hall = await firstValueFrom(
        this.api.commitDrawing(this.slug(), this.venueId(), job.id, {
          ...this.choices(),
          name: this.name.trim(),
          code: this.code.trim() || null,
          level: this.level.trim() || null,
          ...(this.target !== 'new' ? { hallId: this.target } : {}),
        }),
      );
      if (!another) {
        this.notifier.success(
          this.target === 'new' ? `${hall.name} created.` : `${hall.name} has a new floor version.`,
        );
        void this.router.navigate(['/', this.slug(), 'venues', this.venueId(), 'halls', hall.id]);
        return;
      }
      // Another hall from the same sheet: start from the parts not used yet.
      this.savedHalls.update((list) => [...list, hall]);
      const used = new Set(this.choices().parts);
      const rest = this.plan()?.parts.filter((p) => !used.has(p.id)) ?? [];
      this.choices.update((c) => ({ ...c, parts: rest.slice(0, 1).map((p) => p.id) }));
      this.name = '';
      this.code = '';
      this.target = 'new';
      this.halls.update((list) => [...list, hall]);
      await this.refresh();
      this.notifier.success(`${hall.name} created. Choose the parts of the next hall.`);
    } catch (error) {
      this.saveError.set(errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  // ---- drawing helpers --------------------------------------------------------------------

  protected areaFill(area: FloorArea): string {
    return area.color ?? AREA_COLORS[area.kind];
  }

  protected groupLabel(choice: DrawingGroupChoice): string {
    return choice === 'floor' ? 'Stall floor' : AREA_LABELS[choice];
  }

  protected textByLabel(t: DrawingText): string {
    switch (t.by) {
      case 'rules':
        return 'known wording';
      case 'model':
        return 'local model';
      case 'you':
        return 'you';
      default:
        return 'not recognised';
    }
  }
}
