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
  CsvField,
  JsonHallMapping,
  JsonHallPreview,
  JsonHallRow,
  ItpoImportResult,
} from '../../../core/api/api.models';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import { geometryArea } from '../../../shared/floor/floor-view.component';
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
interface MappingField {
  key: CsvField;
  label: string;
  required: boolean;
}
type AreaField = 'x' | 'y' | 'width' | 'height' | 'kind' | 'label' | 'geometry';
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
            A row is a whole hall, or one space of a hall (outline, foyer, pillar) grouped by its
            hall column. Layout exports with length, breadth, layout_data, legends and annotations
            are recognised. Other column names are suggested and can be mapped; geometry and foyer
            cells may contain JSON arrays or objects.
          </p>
        } @else {
          <p class="muted">
            {{ fileName() }} · {{ choices().length }} hall(s) found
            @if (preview()?.columns?.length) {
              · {{ preview()!.columns!.length }} columns
            }
          </p>
          @if (layoutHinted()) {
            <p class="hint" role="status">
              Several rows share a hall ID and have position and type columns. If each row is one
              space of a hall (outline, foyer, pillar or stall), read the rows as spaces.
              <button mat-stroked-button (click)="useSpaceRows()" [disabled]="busy()">
                Read one row per space
              </button>
            </p>
          }
          <details data-import-guide="mapping" [open]="mappingOpen()">
            <summary>Units and field mapping</summary>
            @if (preview()?.format === 'itpo') {
              <p class="muted">
                Recognised layout export: its columns are read by their own names, so no mapping is
                needed.
              </p>
            } @else {
              <p class="muted">
                Each field reads the column shown. Choose another column if a suggestion is wrong;
                columns no field reads are ignored.
                @if (mapping.rows === 'space') {
                  A polygon column can replace position and size. Each hall needs a row of type Hall
                  outline: its outline is never guessed from its spaces.
                } @else {
                  Width and depth are not needed when the file has a boundary polygon.
                }
              </p>
            }
            <div class="fields">
              <label
                >Rows in this file<select
                  aria-label="CSV row layout"
                  [ngModel]="mapping.rows ?? 'hall'"
                  (ngModelChange)="setLayout($event)"
                >
                  <option value="hall">One row per hall</option>
                  <option value="space">One row per space, grouped by hall</option>
                </select></label
              >
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
            </div>
            @if (missingLabels().length) {
              <p class="error" role="alert">
                Map the required column(s): {{ missingLabels().join(', ') }}.
              </p>
            }
            <h3>Column for each field</h3>
            <div class="fields">
              @for (field of mappingFields; track field.key) {
                <label
                  ><span
                    >{{ field.label }}
                    @if (field.required) {
                      <span class="required">required</span>
                    }</span
                  ><select
                    [attr.aria-label]="'CSV ' + field.label + ' column'"
                    [ngModel]="columnOf(field.key)"
                    (ngModelChange)="setColumn(field.key, $event)"
                    [disabled]="preview()?.format === 'itpo'"
                  >
                    <option [ngValue]="undefined">
                      Automatic{{ suggestion(field.key) ? ': ' + suggestion(field.key) : '' }}
                    </option>
                    @if (!field.required) {
                      <option value="">Not in this file</option>
                    }
                    @for (c of columnOptions.columns; track c) {
                      <option [value]="c">{{ c }}</option>
                    }
                    @if (columnOptions.paths.length) {
                      <optgroup label="Inside JSON cells">
                        @for (p of columnOptions.paths; track p) {
                          <option [value]="p">{{ p }}</option>
                        }
                      </optgroup>
                    }
                  </select></label
                >
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
            @if (preview()?.columns?.length) {
              <details>
                <summary>Columns in this file ({{ preview()!.columns!.length }})</summary>
                <div class="table-scroll">
                  <table aria-label="CSV columns and how they are read">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>First value</th>
                        <th>Read as</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of preview()!.columns!; track c) {
                        <tr>
                          <td>{{ c }}</td>
                          <td class="muted">{{ preview()?.samples?.[c] }}</td>
                          <td [class.muted]="usageOf(c) === 'Not used'">{{ usageOf(c) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </details>
            }
            @if (mapping.rows !== 'space') {
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
            }
            @if (preview()?.areaTypes?.length) {
              <h3>{{ mapping.rows === 'space' ? 'Space types' : 'Area meanings' }}</h3>
              <p class="muted">
                @if (mapping.rows === 'space') {
                  Choose what each space type is. Stall rows are listed but not imported: stalls
                  come with the planner.
                } @else {
                  Choose a meaning for unknown types or colours. A colour is not assumed to be a
                  restriction.
                }
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
                      @if (mapping.rows === 'space') {
                        @for (k of spaceRoles; track k.value) {
                          <option [value]="k.value">{{ k.label }}</option>
                        }
                      }
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
            <details class="records" open>
              <summary>Mapped records ({{ choices().length }})</summary>
              <div class="table-scroll">
                <table aria-label="Mapped CSV records">
                  <thead>
                    <tr>
                      <th>Hall ID</th>
                      <th>Hall name</th>
                      <th>Hall floor</th>
                      <th>Foyers</th>
                      <th>Restrictions</th>
                      @if (preview()?.rowLayout === 'space') {
                        <th>CSV rows</th>
                      }
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of choices(); track c.row.externalId) {
                      <tr [class.error]="!!c.row.error">
                        <td>{{ c.row.sourceId ?? '—' }}</td>
                        <td>{{ c.row.name }}</td>
                        <td>
                          @if (c.row.floor) {
                            {{ c.row.floorArea | number: '1.0-2' }} m²
                          } @else {
                            —
                          }
                        </td>
                        <td>{{ foyerSummary(c.row) }}</td>
                        <td>{{ c.row.floor?.geometry?.objects?.length ?? 0 }}</td>
                        @if (preview()?.rowLayout === 'space') {
                          <td>{{ c.row.records }}</td>
                        }
                        <td>
                          {{
                            c.row.error
                              ? 'Error'
                              : c.row.warnings.length
                                ? c.row.warnings.length + ' note(s)'
                                : 'Ready'
                          }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
          }
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
    .hint {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      font-size: 13px;
    }
    .required {
      margin-left: 6px;
      color: var(--mat-sys-error);
      font-size: 11px;
    }
    .table-scroll {
      max-height: 260px;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th,
    td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--mat-sys-surface);
    }
    tr.error td {
      color: var(--mat-sys-error);
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
    if (this.missingLabels().length)
      pending.unshift(`Map the required column(s): ${this.missingLabels().join(', ')}.`);
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
  private readonly hallFields: MappingField[] = [
    { key: 'id', label: 'Hall ID', required: false },
    { key: 'name', label: 'Hall name', required: false },
    { key: 'width', label: 'Width', required: true },
    { key: 'depth', label: 'Depth', required: true },
    { key: 'boundary', label: 'Boundary polygon', required: false },
    { key: 'zones', label: 'Foyers', required: false },
    { key: 'areas', label: 'Areas and restrictions', required: false },
    { key: 'unitField', label: 'Unit per row', required: false },
  ];
  private readonly spaceFields: MappingField[] = [
    { key: 'id', label: 'Hall', required: true },
    { key: 'name', label: 'Hall name', required: false },
    { key: 'kind', label: 'Space type', required: true },
    { key: 'x', label: 'X position', required: true },
    { key: 'y', label: 'Y position', required: true },
    { key: 'width', label: 'Width', required: true },
    { key: 'depth', label: 'Depth', required: true },
    { key: 'geometry', label: 'Polygon', required: false },
    { key: 'label', label: 'Space name', required: false },
    { key: 'unitField', label: 'Unit per row', required: false },
  ];
  protected readonly spaceRoles = [
    { value: 'hall', label: 'Hall outline' },
    { value: 'foyer', label: 'Foyer' },
    { value: 'circulation', label: 'Circulation / lobby' },
    { value: 'stall', label: 'Stall (listed, not imported)' },
  ];
  protected get mappingFields(): MappingField[] {
    return this.mapping.rows === 'space' ? this.spaceFields : this.hallFields;
  }
  /** Columns first; in hall rows also paths inside the first row's JSON cells. */
  protected get columnOptions(): { columns: string[]; paths: string[] } {
    const p = this.preview();
    const columns = p?.columns ?? p?.fields ?? [];
    const paths =
      this.mapping.rows === 'space' ? [] : (p?.fields ?? []).filter((f) => !columns.includes(f));
    return { columns, paths };
  }
  /** The preview's suggestion, while it was read with the layout now chosen. */
  protected suggestion(field: CsvField): string | undefined {
    const p = this.preview();
    return p && (p.rowLayout ?? 'hall') === (this.mapping.rows ?? 'hall')
      ? p.suggested?.[field]
      : undefined;
  }
  protected missingLabels(): string[] {
    const p = this.preview();
    if (!p?.missing?.length || (p.rowLayout ?? 'hall') !== (this.mapping.rows ?? 'hall')) return [];
    return p.missing.map((key) =>
      key === 'unit'
        ? 'Source units or a units column'
        : (this.mappingFields.find((f) => f.key === key)?.label ?? key),
    );
  }
  protected layoutHinted(): boolean {
    return this.preview()?.layoutHint === 'space' && this.mapping.rows !== 'space';
  }
  /** Where a field's column is kept: a space row's position and size are its area fields. */
  private slot(field: CsvField): { area: AreaField } | { top: keyof JsonHallMapping } {
    if (this.mapping.rows === 'space' && !['id', 'name', 'unitField'].includes(field))
      return { area: field === 'depth' ? 'height' : (field as AreaField) };
    return { top: field as keyof JsonHallMapping };
  }
  /** undefined: automatic; '': not in this file; otherwise the column or path. */
  protected columnOf(field: CsvField): string | undefined {
    const s = this.slot(field);
    return 'area' in s
      ? this.mapping.areaFields?.[s.area]
      : (this.mapping[s.top] as string | undefined);
  }
  protected setColumn(field: CsvField, value: string | undefined) {
    const s = this.slot(field);
    if ('area' in s) {
      this.mapping.areaFields ??= {};
      if (value === undefined) delete this.mapping.areaFields[s.area];
      else this.mapping.areaFields[s.area] = value;
    } else if (value === undefined) delete this.mapping[s.top];
    else (this.mapping as Record<string, unknown>)[s.top] = value;
    this.mappingChanged();
  }
  protected usageOf(column: string): string {
    const p = this.preview();
    const used = this.mappingFields
      .filter((f) => {
        const mapped = p?.format === 'itpo' ? undefined : this.columnOf(f.key);
        return (mapped !== undefined ? mapped : this.suggestion(f.key)) === column;
      })
      .map((f) => f.label);
    return used.length ? used.join(', ') : (p?.autoColumns?.[column] ?? 'Not used');
  }
  protected setLayout(rows: 'hall' | 'space') {
    if ((this.mapping.rows ?? 'hall') === rows) return;
    // A column means another field in the other layout, so the field mapping starts again.
    const { unit, metresPerUnit, yAxis } = this.mapping;
    this.mapping = {
      kinds: Object.create(null),
      ...(rows === 'space' ? { rows } : {}),
      ...(unit ? { unit } : {}),
      ...(metresPerUnit !== undefined ? { metresPerUnit } : {}),
      ...(yAxis ? { yAxis } : {}),
    };
    this.mappingChanged();
  }
  protected useSpaceRows() {
    this.setLayout('space');
    void this.refresh();
  }
  protected foyerSummary(row: JsonHallRow): string {
    const zones = row.floor?.geometry?.zones ?? [];
    if (!zones.length) return '—';
    const area = zones.reduce((sum, z) => sum + geometryArea(z.geometry), 0);
    return `${zones.length} · ${Math.round(area)} m²`;
  }
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
      this.mappingOpen.set(!p.rows.length || p.rows.some((r) => !!r.error) || !!p.missing?.length);
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
