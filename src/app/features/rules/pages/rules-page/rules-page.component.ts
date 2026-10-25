import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { Subscription, forkJoin, merge } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import {
  RuleSwitchListComponent,
  RuleToggle,
} from '../../components/rule-switch-list/rule-switch-list.component';
import { RuleValuesFormComponent } from '../../components/rule-values-form/rule-values-form.component';
import { RuleCatalogue, RuleSet, RuleSetChanges } from '../../data/rules.models';
import { HallRulesPanelComponent } from '../../components/hall-rules-panel/hall-rules-panel.component';
import { ItpoHallsApiService } from '../../../halls/data/itpo-halls-api.service';
import { FormsModule } from '@angular/forms';
import { RulesApiService } from '../../data/rules-api.service';
import { itemsOfRuleSet } from '../../domain/rule-items';
import { createValuesForm, toRuleValues, ValuesForm } from '../../domain/rule-values.form';

/** The rules every hall follows: which are on, their values, and the documents they come from. */
@Component({
  selector: 'app-rules-page',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    SkeletonModule,
    FormFieldComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    RuleSwitchListComponent,
    RuleValuesFormComponent,
    HallRulesPanelComponent,
    FormsModule,
  ],
  templateUrl: './rules-page.component.html',
  styleUrl: './rules-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulesPageComponent {
  private readonly api = inject(RulesApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly catalogue = signal<RuleCatalogue | null>(null);
  protected readonly switches = signal<Record<string, boolean>>({});
  protected readonly valuesForm = signal<ValuesForm | null>(null);
  protected readonly profile = new FormControl('free', { nonNullable: true });
  protected readonly references = new FormArray<ReferenceGroup>([]);

  private readonly hallsApi = inject(ItpoHallsApiService);
  /** The hall whose rules are shown; null: the default rules every hall follows. */
  protected readonly hallId = signal<number | null>(null);
  private readonly halls = signal<Array<{ id: number; name: string }>>([]);
  protected readonly scopes = computed(() => [
    { id: null as number | null, label: 'All halls (the default rules)' },
    ...this.halls().map((h) => ({ id: h.id as number | null, label: h.name })),
  ]);
  protected readonly hallName = computed(
    () => this.halls().find((h) => h.id === this.hallId())?.name ?? 'this hall',
  );

  protected chooseHall(id: number | null): void {
    this.hallId.set(id);
  }

  private loaded: RuleSet | null = null;
  private readonly switchesChanged = signal(false);
  private readonly formChanged = signal(false);
  private tracking: Subscription | null = null;

  protected readonly items = computed(() =>
    itemsOfRuleSet(this.catalogue()?.rules ?? [], this.switches()),
  );
  protected readonly hasChanges = computed(() => this.switchesChanged() || this.formChanged());
  protected readonly selectedProfile = computed(() => {
    this.formChanged();
    return this.catalogue()?.profiles.find((p) => p.id === this.profile.value) ?? null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.tracking?.unsubscribe());
    this.hallsApi
      .halls({ page: 1, size: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.halls.set(page.items.map((h) => ({ id: h.id, name: h.name }))),
        error: () => undefined,
      });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    forkJoin([this.api.catalogue(), this.api.ruleSet()])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([catalogue, ruleSet]) => {
          this.catalogue.set(catalogue);
          this.apply(ruleSet);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadFailed.set(true);
          this.notifier.fromError(error, 'The rules could not be loaded');
        },
      });
  }

  protected onToggle({ id, enabled }: RuleToggle): void {
    this.switches.update((current) => ({ ...current, [id]: enabled }));
    this.switchesChanged.set(!sameSwitches(this.switches(), this.loaded?.switches ?? {}));
  }

  protected addReference(): void {
    this.references.push(createReferenceGroup(this.fb));
    this.references.markAsDirty();
    this.formChanged.set(true);
  }

  protected removeReference(index: number): void {
    this.references.removeAt(index);
    this.references.markAsDirty();
    this.formChanged.set(true);
  }

  protected discard(): void {
    if (this.loaded) {
      this.apply(this.loaded);
      this.saveError.set(null);
    }
  }

  protected async save(): Promise<void> {
    const values = this.valuesForm();
    if (!values) {
      return;
    }
    if (values.invalid || this.references.invalid) {
      values.markAllAsTouched();
      this.references.markAllAsTouched();
      return;
    }

    const changes: RuleSetChanges = {};
    if (this.switchesChanged()) changes.switches = this.switches();
    if (values.dirty) changes.values = toRuleValues(values);
    if (this.profile.dirty) changes.drawingProfile = this.profile.value;
    if (this.references.dirty) {
      changes.references = this.references.getRawValue().map((r) => ({
        document: r.document.trim(),
        section: r.section.trim() || null,
        note: r.note.trim() || null,
      }));
    }

    const go = await this.confirm.ask({
      header: 'Save the default rules',
      message:
        'These rules apply to every hall and every event that follows the default. Save them?',
      acceptLabel: 'Save',
    });
    if (!go) {
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    this.api
      .updateRuleSet(changes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ruleSet) => {
          this.apply(ruleSet);
          this.saving.set(false);
          this.notifier.success('Rules saved', 'They apply to every hall from now on.');
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.saveError.set(
            error instanceof ApiError ? error.message : 'The rules could not be saved.',
          );
        },
      });
  }

  /** Puts a rule set on the page, and starts counting changes from it. */
  private apply(ruleSet: RuleSet): void {
    this.loaded = ruleSet;
    this.switches.set({ ...ruleSet.switches });
    this.switchesChanged.set(false);

    const form = createValuesForm(this.fb, ruleSet.values);
    this.valuesForm.set(form);
    this.profile.reset(ruleSet.drawingProfile);

    this.references.clear();
    ruleSet.references.forEach((reference) =>
      this.references.push(
        createReferenceGroup(
          this.fb,
          reference.document,
          reference.section ?? '',
          reference.note ?? '',
        ),
      ),
    );
    this.references.markAsPristine();

    this.formChanged.set(false);
    this.tracking?.unsubscribe();
    this.tracking = merge(
      form.valueChanges,
      this.profile.valueChanges,
      this.references.valueChanges,
    ).subscribe(() => this.formChanged.set(true));
  }
}

function createReferenceGroup(fb: FormBuilder, document = '', section = '', note = '') {
  return fb.nonNullable.group({
    document: [document, [Validators.required, Validators.maxLength(200)]],
    section: [section, [Validators.maxLength(60)]],
    note: [note, [Validators.maxLength(300)]],
  });
}

type ReferenceGroup = ReturnType<typeof createReferenceGroup>;

function sameSwitches(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] !== false) === (b[key] !== false));
}
