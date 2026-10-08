import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import type {
  JsonHallMapping,
  JsonHallPreview,
  JsonHallRow,
  ItpoImportResult,
} from '../../../core/api/api.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { ThreePlanComponent } from '../../../shared/floor/three-plan.component';
import { ImportTourComponent } from '../../../shared/import-tour/import-tour.component';
import { locateImportControl } from '../../../shared/import-tour/locate-import-control';
export interface CsvImportDialogData {
  slug: string;
  venueId: string;
  venueName: string;
}
interface Choice {
  row: JsonHallRow;
  selected: boolean;
  name: string;
  inspected: boolean;
}
@Component({
  selector: 'app-csv-import-dialog',
  imports: [
    DecimalPipe,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatProgressBarModule,
    ThreePlanComponent,
    ImportTourComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <h2 mat-dialog-title>Import from CSV</h2>
    <mat-dialog-content>
      <app-import-tour
        mode="csv"
        [autoOpen]="true"
        [stage]="content ? 1 : 0"
        [blockers]="guideBlockers"
        (locate)="showGuideTopic($event)"
      />
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (result(); as r) {
        <p>
          {{ r.created.length }} halls created, {{ r.updated.length }} updated,
          {{ r.unchanged.length }} already up to date in {{ data.venueName }}.
        </p>
      } @else {
        @if (!content) {
          <p>
            Upload your venue’s CSV file. We will convert its halls, foyers and restrictions into
            our hall format, then show the result before saving.
          </p>
          <label
            class="drop"
            data-import-guide="upload"
            (dragover)="$event.preventDefault()"
            (drop)="drop($event)"
          >
            <b>Choose a CSV file or drop it here</b
            ><span>Up to 12 MB · one hall or several halls</span>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Choose venue CSV file"
              (change)="pick($event)"
              [disabled]="busy()"
            />
          </label>
          <p class="muted">
            Each CSV row becomes a separate hall. Layout exports with length, breadth, layout_data,
            legends and annotations are recognised. Other column names can be mapped; geometry and
            foyer cells may contain JSON arrays or objects.
          </p>
        } @else {
          <p class="muted">{{ fileName() }} · {{ choices().length }} hall(s) found</p>
          <details data-import-guide="mapping" [open]="mappingOpen()">
            <summary>Units and field mapping</summary>
            <p class="muted">
              Leave recognised fields on Automatic. Choose source units if they are missing from the
              file.
            </p>
            <div class="fields">
              <label
                >Source units<select
                  aria-label="CSV source units"
                  [(ngModel)]="mapping.unit"
                  (ngModelChange)="mappingChanged()"
                >
                  <option [ngValue]="undefined">Automatic from file</option>
                  <option value="m">Metres</option>
                  <option value="mm">Millimetres</option>
                  <option value="cm">Centimetres</option>
                  <option value="ft">Feet</option>
                  <option value="in">Inches</option>
                  <option value="px">Pixels / custom scale</option>
                </select></label
              >
              @if (mapping.unit === 'px') {
                <label
                  >Metres per source unit<input
                    type="number"
                    aria-label="CSV metres per source unit"
                    min="0.000000001"
                    step="any"
                    [(ngModel)]="mapping.metresPerUnit"
                    (ngModelChange)="mappingChanged()"
                /></label>
              }
              @for (field of fields; track field.key) {
                <label
                  >{{ field.label
                  }}<input
                    type="text"
                    [attr.aria-label]="'CSV ' + field.label + ' field'"
                    [ngModel]="mapping[field.key]"
                    (ngModelChange)="setField(field.key, $event)"
                    list="csv-fields"
                    placeholder="Automatic"
                /></label>
              }
            </div>
            <label
              >Source Y direction<select
                aria-label="CSV Y direction"
                [(ngModel)]="mapping.yAxis"
                (ngModelChange)="mappingChanged()"
              >
                <option [ngValue]="undefined">Downwards (drawing coordinates)</option>
                <option value="up">Upwards (Cartesian coordinates)</option>
              </select></label
            >
            <details>
              <summary>Custom area fields</summary>
              <p class="muted">
                Use these only if each rectangle or polygon uses different field names. Paths are
                relative to one area object.
              </p>
              <div class="fields">
                @for (field of areaFields; track field.key) {
                  <label
                    >{{ field.label
                    }}<input
                      [attr.aria-label]="'CSV area ' + field.label + ' field'"
                      [ngModel]="mapping.areaFields?.[field.key]"
                      (ngModelChange)="setAreaField(field.key, $event)"
                      placeholder="Automatic"
                  /></label>
                }
              </div>
            </details>
            <datalist id="csv-fields">
              @for (p of preview()?.fields ?? []; track p) {
                <option [value]="p"></option>
              }
            </datalist>
            @if (preview()?.areaTypes?.length) {
              <h3>Area meanings</h3>
              <p class="muted">
                Choose a meaning for unknown types or colours. A colour is not assumed to be a
                restriction.
              </p>
              <div class="fields">
                @for (t of preview()?.areaTypes ?? []; track t) {
                  <label
                    >{{ t || 'Area without a type'
                    }}<select
                      [attr.aria-label]="'Meaning of CSV area ' + (t || '(missing)')"
                      [ngModel]="mapping.kinds?.[t]"
                      (ngModelChange)="setKind(t, $event)"
                    >
                      <option [ngValue]="undefined">Use source meaning</option>
                      @for (k of kinds; track k.value) {
                        <option [value]="k.value">{{ k.label }}</option>
                      }
                    </select></label
                  >
                }
              </div>
            }
            <button mat-stroked-button (click)="refresh()" [disabled]="busy()">
              Update preview
            </button>
            @if (mappingDirty()) {
              <p class="warning">Update the preview before reviewing or saving halls.</p>
            }
          </details>
          @if (choices().length) {
            @if (selectedCount()) {
              <div class="batch-progress" role="status">
                <p>
                  <b>{{ reviewedCount() }} of {{ selectedCount() }} selected halls reviewed.</b>
                  @if (remainingCount()) {
                    Check and confirm each hall preview to enable batch Save.
                  } @else {
                    All selected previews are checked.
                  }
                </p>
                @if (remainingCount()) {
                  <button mat-stroked-button (click)="reviewNext()" [disabled]="busy()">
                    Go to pending hall
                  </button>
                }
              </div>
            }
            <div class="review-layout" [attr.inert]="busy() ? '' : null">
              <section class="hall-list" data-import-guide="choose">
                <h3>Choose halls</h3>
                <button mat-button (click)="selectAll(true)">Select all available</button>
                <button mat-button (click)="selectAll(false)">Clear selection</button>
                @for (c of choices(); track c.row.externalId) {
                  <div class="hall-row" [class.active]="activeId() === c.row.externalId">
                    <label class="check"
                      ><input
                        type="checkbox"
                        [checked]="c.selected"
                        (change)="toggle(c, $any($event.target).checked)"
                        [disabled]="!!c.row.error || !!c.row.existing?.sameFloor"
                        [attr.aria-label]="'Include CSV hall ' + c.row.name"
                      />
                      <button class="hall-link" (click)="activeId.set(c.row.externalId)">
                        {{ c.row.name }}
                      </button></label
                    >
                    @if (c.row.error) {
                      <p class="error">{{ c.row.error }}</p>
                    } @else {
                      <p class="muted">
                        {{ c.row.width | number: '1.0-2' }} × {{ c.row.depth | number: '1.0-2' }} m
                      </p>
                      @if (c.row.existing) {
                        <p class="muted">
                          {{
                            c.row.existing.sameFloor
                              ? 'Already up to date'
                              : 'Update ' + c.row.existing.name
                          }}
                        </p>
                      }
                      <span class="muted">{{
                        c.inspected ? 'Preview checked ✓' : 'Check preview before saving'
                      }}</span>
                    }
                  </div>
                }
              </section>
              <section class="hall-preview" data-import-guide="preview">
                @if (active(); as c) {
                  @if (c.row.floor?.geometry; as g) {
                    <div class="preview-heading">
                      <h3>{{ c.row.name }}</h3>
                      <button mat-button (click)="canvas?.fit()">Fit</button>
                    </div>
                    @if (c.selected) {
                      <p class="muted">Hall {{ activeIndex() + 1 }} of {{ selectedCount() }}</p>
                    }
                    <app-three-plan [floor]="g" [floorInfo]="c.row.floor" [editable]="false" />
                    <p class="muted">
                      Scroll to zoom · drag to pan · {{ c.row.floorArea | number: '1.0-2' }} m² hall
                      floor
                    </p>
                    <label
                      >Hall name<input
                        aria-label="CSV hall name"
                        [ngModel]="c.name"
                        (ngModelChange)="rename(c, $event)"
                        maxlength="120"
                        [disabled]="!!c.row.existing"
                    /></label>
                    @for (w of c.row.warnings; track $index) {
                      <p class="warning">{{ w }}</p>
                    }
                    <label class="check final-check"
                      ><input
                        type="checkbox"
                        [attr.aria-label]="'Confirm reviewed CSV hall ' + c.row.name"
                        [checked]="c.inspected"
                        (change)="inspect(c, $any($event.target).checked)"
                        [disabled]="mappingDirty()"
                      />The converted hall, foyers and restrictions look correct</label
                    >
                    @if (c.inspected && remainingCount()) {
                      <button mat-stroked-button (click)="reviewNext()" [disabled]="mappingDirty()">
                        Review next hall
                      </button>
                    }
                    <button mat-button (click)="download(c)">Download converted JSON</button>
                  } @else {
                    <p>Adjust the mapping above, then update the preview for this hall.</p>
                  }
                }
              </section>
            </div>
          }
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" data-import-guide="save">
      @if (result()) {
        <button mat-flat-button [mat-dialog-close]="true">Done</button>
      } @else {
        @if (content) {
          <button mat-button (click)="reset()" [disabled]="busy()">Other file</button>
          @if (remainingCount()) {
            <span role="status">
              {{ remainingCount() }} selected
              {{ remainingCount() === 1 ? 'hall still needs' : 'halls still need' }} review.
            </span>
          }
        }
        <button mat-button mat-dialog-close [disabled]="busy()">Cancel</button>
        <button mat-flat-button (click)="save()" [disabled]="!canSave()">
          Save {{ selectedCount() || '' }} {{ selectedCount() === 1 ? 'hall' : 'halls' }}
        </button>
      }
    </mat-dialog-actions>`,
  styles: `
    mat-dialog-content {
      min-width: 0;
    }
    .drop {
      display: grid;
      gap: 12px;
      position: relative;
      text-align: center;
      padding: 40px 20px;
      border: 2px dashed var(--mat-sys-outline-variant);
      border-radius: 12px;
    }
    .drop input {
      position: absolute;
      inset: 0;
      opacity: 0;
      width: 100%;
      cursor: pointer;
    }
    details {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      padding: 14px;
      margin: 16px 0;
    }
    summary {
      cursor: pointer;
      color: var(--mat-sys-primary);
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      margin: 12px 0;
      font-size: 13px;
    }
    input:not([type='checkbox']):not([type='file']),
    select {
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 6px;
      background: var(--mat-sys-surface);
      color: inherit;
      padding: 8px;
      font: inherit;
    }
    .review-layout {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      gap: 20px;
      margin-top: 20px;
    }
    .batch-progress {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .batch-progress p {
      flex: 1 1 260px;
    }
    .hall-row {
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      margin: 10px 0;
    }
    .hall-row.active {
      border-color: var(--mat-sys-primary);
    }
    .hall-link {
      border: 0;
      background: none;
      color: var(--mat-sys-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .check {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      line-height: 1.6;
    }
    .check input {
      margin-top: 4px;
      flex: none;
    }
    .final-check {
      padding: 12px;
      background: #e2f3e9;
      color: #1c6841;
      border-radius: 8px;
    }
    .preview-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .warning {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    button:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
    }
    app-three-plan {
      --plan-canvas-height: 42vh;
      --plan-canvas-min-height: 300px;
    }
    @media (max-width: 700px) {
      .review-layout {
        grid-template-columns: 1fr;
      }
      .hall-list {
        max-height: 250px;
        overflow: auto;
      }
    }
  `,
})
export class CsvImportDialogComponent {
  protected data = inject<CsvImportDialogData>(MAT_DIALOG_DATA);
  private api = inject(VenuesApi);
  private element = inject<ElementRef<HTMLElement>>(ElementRef);
  private ref = inject(MatDialogRef<CsvImportDialogComponent, boolean>);
  @ViewChild(ThreePlanComponent) protected canvas?: ThreePlanComponent;
  protected content = '';
  protected mapping: JsonHallMapping = { kinds: Object.create(null) };
  protected fileName = signal('');
  protected choices = signal<Choice[]>([]);
  protected preview = signal<JsonHallPreview | null>(null);
  protected activeId = signal('');
  protected mappingDirty = signal(false);
  protected mappingOpen = signal(false);
  protected busy = signal(false);
  protected error = signal('');
  protected result = signal<ItpoImportResult | null>(null);
  protected get guideBlockers(): string[] {
    if (this.result()) return [];
    if (this.error()) return [this.error()];
    if (!this.content) return [];
    const pending = this.choices()
      .filter((c) => c.row.error)
      .map((c) => `${c.row.name}: ${c.row.error}`);
    if (this.mappingDirty()) pending.push('Click Update preview after changing the mapping.');
    if (!this.selectedCount())
      pending.push('Select at least one converted hall that needs saving.');
    for (const choice of this.choices().filter((c) => c.selected)) {
      if (!choice.inspected)
        pending.push(`${choice.row.name}: inspect its preview and confirm it looks correct.`);
      if (!choice.name.trim()) pending.push(`${choice.row.name}: enter a hall name.`);
    }
    return pending;
  }
  protected showGuideTopic(topic: string) {
    if (topic === 'mapping') this.mappingOpen.set(true);
    setTimeout(() => locateImportControl(this.element.nativeElement, topic));
  }
  protected active = computed(() =>
    this.choices().find((c) => c.row.externalId === this.activeId()),
  );
  protected selectedCount = computed(
    () => this.choices().filter((c) => c.selected && !c.row.error).length,
  );
  protected reviewedCount = computed(
    () => this.choices().filter((c) => c.selected && !c.row.error && c.inspected).length,
  );
  protected remainingCount = computed(() => this.selectedCount() - this.reviewedCount());
  protected activeIndex = computed(() =>
    this.choices()
      .filter((c) => c.selected && !c.row.error)
      .findIndex((c) => c.row.externalId === this.activeId()),
  );
  protected canSave = computed(
    () =>
      !this.busy() &&
      !this.mappingDirty() &&
      this.selectedCount() > 0 &&
      this.choices()
        .filter((c) => c.selected)
        .every((c) => !c.row.error && c.inspected && c.name.trim()),
  );
  protected fields: {
    key: 'name' | 'width' | 'depth' | 'boundary' | 'areas' | 'zones';
    label: string;
  }[] = [
    { key: 'name', label: 'Hall name' },
    { key: 'width', label: 'Width' },
    { key: 'depth', label: 'Depth' },
    { key: 'boundary', label: 'Boundary' },
    { key: 'areas', label: 'Areas' },
    { key: 'zones', label: 'Foyers' },
  ];
  protected kinds = [
    { value: 'wall', label: 'Wall' },
    { value: 'column', label: 'Column' },
    { value: 'passage', label: 'Passage' },
    { value: 'fire_curtain', label: 'Fire curtain' },
    { value: 'no_build', label: 'No construction' },
    { value: 'utility', label: 'Utility' },
    { value: 'entry', label: 'Entry / exit' },
    { value: 'unavailable', label: 'Unavailable' },
    { value: 'void', label: 'Floor opening' },
    { value: 'facility', label: 'Facility' },
    { value: 'outside', label: 'Outside hall' },
    { value: 'marking', label: 'Drawing only' },
  ];
  constructor() {
    this.ref.disableClose = true;
    this.ref.backdropClick().subscribe(() => {
      if (!this.busy()) this.ref.close(!!this.result());
    });
  }
  protected pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void this.read(f);
  }
  protected drop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f && !this.busy()) void this.read(f);
  }
  private async read(file: File) {
    this.error.set('');
    if (!/\.csv$/i.test(file.name)) {
      this.error.set('Choose a .csv file with a header row and one row per hall.');
      return;
    }
    if (file.size > 12_000_000) {
      this.error.set('Choose a CSV file up to 12 MB.');
      return;
    }
    this.mapping = { kinds: Object.create(null) };
    this.choices.set([]);
    this.preview.set(null);
    this.mappingDirty.set(false);
    this.content = await file.text();
    this.fileName.set(file.name);
    await this.refresh();
  }
  protected areaFields: {
    key: 'x' | 'y' | 'width' | 'height' | 'kind' | 'label' | 'geometry';
    label: string;
  }[] = [
    { key: 'x', label: 'X position' },
    { key: 'y', label: 'Y position' },
    { key: 'width', label: 'Width' },
    { key: 'height', label: 'Height' },
    { key: 'kind', label: 'Meaning / type' },
    { key: 'label', label: 'Label' },
    { key: 'geometry', label: 'Polygon geometry' },
  ];
  protected setAreaField(
    field: 'x' | 'y' | 'width' | 'height' | 'kind' | 'label' | 'geometry',
    value: string,
  ) {
    this.mapping.areaFields ??= {};
    this.mapping.areaFields[field] = value.trim() || undefined;
    this.mappingChanged();
  }
  protected mappingChanged() {
    if (this.mapping.unit !== 'px') delete this.mapping.metresPerUnit;
    this.mappingDirty.set(true);
    this.choices.update((all) => all.map((c) => ({ ...c, inspected: false })));
  }
  protected setField(
    field: 'name' | 'width' | 'depth' | 'boundary' | 'areas' | 'zones',
    value: string,
  ) {
    this.mapping[field] = value.trim() || undefined;
    this.mappingChanged();
  }
  protected setKind(token: string, value: string | undefined) {
    this.mapping.kinds ??= Object.create(null);
    if (value) this.mapping.kinds![token] = value;
    else delete this.mapping.kinds![token];
    this.mappingChanged();
  }
  protected async refresh() {
    this.busy.set(true);
    this.error.set('');
    try {
      const p = await firstValueFrom(
        this.api.previewCsv(this.data.slug, this.data.venueId, this.content, this.mapping),
      );
      this.preview.set(p);
      this.choices.set(
        p.rows.map((row) => ({
          row,
          selected: !row.error && !row.existing?.sameFloor,
          name: row.existing?.name ?? row.name,
          inspected: false,
        })),
      );
      this.activeId.set(p.rows.find((r) => !r.error)?.externalId ?? p.rows[0]?.externalId ?? '');
      this.mappingOpen.set(p.rows.some((r) => !!r.error));
      this.mappingDirty.set(false);
    } catch {
      // The error interceptor has shown it.
      this.mappingDirty.set(true);
      this.mappingOpen.set(true);
    } finally {
      this.busy.set(false);
    }
  }
  protected toggle(c: Choice, on: boolean) {
    this.choices.update((all) => all.map((x) => (x === c ? { ...x, selected: on } : x)));
  }
  protected selectAll(on: boolean) {
    this.choices.update((all) =>
      all.map((c) => ({ ...c, selected: on && !c.row.error && !c.row.existing?.sameFloor })),
    );
  }
  protected rename(c: Choice, name: string) {
    this.choices.update((all) => all.map((x) => (x === c ? { ...x, name } : x)));
  }
  protected inspect(c: Choice, on: boolean) {
    this.choices.update((all) => all.map((x) => (x === c ? { ...x, inspected: on } : x)));
  }
  protected reviewNext() {
    const selected = this.choices().filter((c) => c.selected && !c.row.error);
    const index = selected.findIndex((c) => c.row.externalId === this.activeId());
    const next = [...selected.slice(index + 1), ...selected.slice(0, index + 1)].find(
      (c) => !c.inspected,
    );
    if (next) this.activeId.set(next.row.externalId);
  }
  protected reset() {
    this.content = '';
    this.preview.set(null);
    this.choices.set([]);
    this.error.set('');
    this.mappingDirty.set(false);
  }
  protected download(c: Choice) {
    if (!c.row.floor) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ name: c.name, floor: c.row.floor }, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted-hall.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  protected async save() {
    if (!this.canSave() || !this.preview()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.result.set(
        await firstValueFrom(
          this.api.importCsv(
            this.data.slug,
            this.data.venueId,
            this.content,
            this.mapping,
            this.choices()
              .filter((c) => c.selected)
              .map((c) => ({
                externalId: c.row.externalId,
                name: c.name.trim(),
                code: null,
                level: null,
              })),
            this.preview()!.previewToken,
          ),
        ),
      );
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
