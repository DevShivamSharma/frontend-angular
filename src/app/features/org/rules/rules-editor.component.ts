import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../../core/api/http-error';
import { OrgContextStore } from '../../../core/org/org.stores';
import { RulesApi } from '../../../core/rules/rules-api.service';
import type {
  RuleCatalogue,
  RuleDefinition,
  RuleGroup,
  RuleId,
  RuleReference,
  RulesView,
  RuleValues,
  ValueLimit,
} from '../../../core/rules/rules.models';
import { Notifier } from '../../../core/ui/notifier.service';

const GROUPS: Array<{ key: RuleGroup; label: string }> = [
  { key: 'floor', label: 'The hall floor' },
  { key: 'access', label: 'Passages and access' },
  { key: 'stalls', label: 'Stalls' },
  { key: 'layout', label: 'The whole layout' },
];

/** Edits the organisation's rules: which checks are on, their values, documents, profile. */
@Component({
  selector: 'app-rules-editor',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="section-title">Drawing</h2>
      <mat-form-field class="full-width">
        <mat-label>Drawing profile of the venue's system</mat-label>
        <mat-select [(ngModel)]="profile">
          @for (p of catalogue().profiles; track p.id) {
            <mat-option [value]="p.id">{{ p.label }}</mat-option>
          }
        </mat-select>
        <mat-hint>{{ profileText() }}</mat-hint>
      </mat-form-field>
    </section>

    @for (g of groups; track g.key) {
      <section class="panel">
        <h2 class="section-title">{{ g.label }}</h2>
        <ul class="rules">
          @for (r of rulesOf(g.key); track r.id) {
            <li [class.waiting]="!r.available">
              <mat-slide-toggle
                [checked]="switches()[r.id]"
                (change)="toggle(r.id, $event.checked)"
                [disabled]="!r.available"
                [aria-label]="r.label"
              />
              <div class="rule">

                <span class="muted small">{{ r.description }}</span>
                @if (!r.available) {
                  <span class="small waiting-for"
                    ><mat-icon inline>hourglass_empty</mat-icon> Takes effect with:
                    {{ r.waitingFor }}</span
                  >
                }
              </div>
            </li>
          }
        </ul>
      </section>
    }

    <section class="panel">
      <h2 class="section-title">Values</h2>
      <div class="form-grid">
        @for (l of catalogue().limits; track l.key) {
          <mat-form-field>
            <mat-label>{{ l.label }}</mat-label>
            <input
              matInput
              type="number"
              [ngModel]="shown(l)"
              (ngModelChange)="setValue(l, $event)"
              [min]="l.unit === 'share' ? l.min * 100 : l.min"
              [max]="l.unit === 'share' ? l.max * 100 : l.max"
              [step]="l.unit === 'share' ? 5 : 0.5"
            />
            <span matTextSuffix>{{ l.unit === 'share' ? '%' : 'm' }}</span>
            <mat-hint>{{
              l.unit === 'share'
                ? l.min * 100 + '–' + l.max * 100 + '%'
                : l.min + '–' + l.max + ' m'
            }}</mat-hint>
          </mat-form-field>
        }
      </div>
      <mat-slide-toggle [(ngModel)]="foyerConstruction">
        Stalls may stand in foyers (constructible foyer areas)
      </mat-slide-toggle>
    </section>

    <section class="panel">
      <div class="row">
        <h2 class="section-title grow">Documents these rules follow</h2>
        <button mat-button (click)="addReference()"><mat-icon>add</mat-icon>Add document</button>
      </div>
      @if (!references().length) {
        <p class="muted">
          None given. Name the guideline document and section each rule comes from, so reviewers can
          check it.
        </p>
      }
      @for (ref of references(); track $index) {
        <div class="ref-row">
          <mat-form-field class="doc">
            <mat-label>Document</mat-label>
            <input
              matInput
              [ngModel]="ref.document"
              (ngModelChange)="setRef($index, 'document', $event)"
              maxlength="200"
            />
          </mat-form-field>
          <mat-form-field class="section">
            <mat-label>Section</mat-label>
            <input
              matInput
              [ngModel]="ref.section ?? ''"
              (ngModelChange)="setRef($index, 'section', $event)"
              maxlength="60"
            />
          </mat-form-field>
          <mat-form-field class="note">
            <mat-label>Note</mat-label>
            <input
              matInput
              [ngModel]="ref.note ?? ''"
              (ngModelChange)="setRef($index, 'note', $event)"
              maxlength="300"
            />
          </mat-form-field>
          <button mat-icon-button (click)="removeRef($index)" aria-label="Remove document">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }
    </section>

    <div class="save row">
      @if (error()) {
        <p class="error grow" role="alert">{{ error() }}</p>
      } @else {
        <span class="grow"></span>
      }
      <button mat-button (click)="reset()" [disabled]="busy()">Undo changes</button>
      <button mat-flat-button (click)="save()" [disabled]="busy()">Save</button>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 16px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
    .grow {
      flex: 1 1 auto;
      margin: 0;
    }
    .rules {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 14px;
    }
    .rules li {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .rules li.waiting {
      opacity: 0.8;
    }
    .rule {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .rule-name {
      font-weight: 600;
    }
    .ref {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-primary);
      margin-left: 6px;
    }
    .waiting-for {
      color: var(--mat-sys-on-surface-variant);
    }
    .ref-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    .doc {
      flex: 2 1 240px;
    }
    .section {
      flex: 0 1 120px;
    }
    .note {
      flex: 2 1 200px;
    }
    .save {
      position: sticky;
      bottom: 0;
      padding: 12px 0;
      background: var(--mat-sys-surface);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class RulesEditorComponent {
  readonly rules = input.required<RulesView>();
  readonly catalogue = input.required<RuleCatalogue>();
  readonly saved = output<RulesView>();

  private readonly api = inject(RulesApi);
  private readonly notifier = inject(Notifier);
  private readonly context = inject(OrgContextStore);

  protected readonly groups = GROUPS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  // The form, as plain fields and signals.
  protected profile = 'free';
  protected foyerConstruction = false;
  protected readonly switches = signal<Record<RuleId, boolean>>({} as Record<RuleId, boolean>);
  private values: RuleValues | null = null;
  protected readonly references = signal<RuleReference[]>([]);

  constructor() {
    effect(() => this.fill(this.rules()));
  }

  /** What the chosen drawing profile asks of a layout. */
  protected profileText(): string {
    return this.catalogue().profiles.find((p) => p.id === this.profile)?.description ?? '';
  }

  private fill(rules: RulesView): void {
    this.profile = rules.drawingProfile;
    this.foyerConstruction = rules.values.foyerConstruction;
    this.switches.set({ ...rules.switches });
    this.values = structuredClone(rules.values);
    this.references.set(rules.references.map((r) => ({ ...r })));
    this.error.set(null);
  }

  protected rulesOf(group: RuleGroup): RuleDefinition[] {
    return this.catalogue().rules.filter((r) => r.group === group);
  }

  protected toggle(id: RuleId, on: boolean): void {
    this.switches.update((s) => ({ ...s, [id]: on }));
  }

  /** A value as shown: shares in percent. */
  protected shown(limit: ValueLimit): number {
    const v = this.read(limit.key);
    return limit.unit === 'share' ? Math.round(v * 100) : v;
  }

  protected setValue(limit: ValueLimit, raw: number | string): void {
    const n = Number(raw);
    if (!this.values || !Number.isFinite(n)) return;
    const v = limit.unit === 'share' ? n / 100 : n;
    const [a, b] = limit.key.split('.');
    if (b) (this.values as unknown as Record<string, Record<string, number>>)[a][b] = v;
    else (this.values as unknown as Record<string, number>)[a] = v;
  }

  private read(key: string): number {
    const [a, b] = key.split('.');
    const v = this.values as unknown as Record<string, unknown> | null;
    const value = b ? (v?.[a] as Record<string, number> | undefined)?.[b] : v?.[a];
    return typeof value === 'number' ? value : 0;
  }

  protected addReference(): void {
    this.references.update((r) => [...r, { document: '', section: null, note: null }]);
  }

  protected setRef(index: number, field: keyof RuleReference, value: string): void {
    this.references.update((r) => r.map((x, i) => (i === index ? { ...x, [field]: value } : x)));
  }

  protected removeRef(index: number): void {
    this.references.update((r) => r.filter((_, i) => i !== index));
  }

  protected reset(): void {
    this.fill(this.rules());
  }

  protected async save(): Promise<void> {
    if (!this.values) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await firstValueFrom(
        this.api.update(this.context.slug(), {
          drawingProfile: this.profile,
          switches: this.switches(),
          values: { ...this.values, foyerConstruction: this.foyerConstruction },
          references: this.references()
            .filter((r) => r.document.trim())
            .map((r) => ({
              document: r.document.trim(),
              section: r.section?.trim() || null,
              note: r.note?.trim() || null,
            })),
        }),
      );
      this.saved.emit(saved);
      this.notifier.success('Rules saved.');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
