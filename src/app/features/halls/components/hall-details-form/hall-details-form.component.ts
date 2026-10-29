import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { startWith } from 'rxjs';

import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { changedValues } from '../../../../shared/utils/form.util';
import { HallCategory, ItpoHall } from '../../data/halls.models';
import { isNtaCategory } from '../../domain/hall-category';

/** A hall's details, edited in place: what was changed is given back, ready to send. */
@Component({
  selector: 'app-hall-details-form',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    SelectButtonModule,
    ToggleSwitchModule,
    FormFieldComponent,
  ],
  templateUrl: './hall-details-form.component.html',
  styleUrl: './hall-details-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallDetailsFormComponent implements OnInit {
  readonly hall = input.required<ItpoHall>();
  readonly categories = input<HallCategory[]>([]);
  readonly saving = input(false);
  /** What the API said when it refused the change. */
  readonly failure = input<string | null>(null);

  readonly saved = output<Record<string, unknown>>();
  readonly cancelled = output<void>();

  protected readonly complimentaryOptions = [
    { label: 'None', value: 0 },
    { label: '1 day', value: 1 },
  ];

  // Named as the API names them, so the changed controls are the body as they are.
  protected readonly form = inject(FormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    hallCategoryId: [null as number | null],
    hallAreaCapacity: [null as number | null, [Validators.min(0)]],
    isPopular: [false],
    isVipLounge: [false],
    isAvailableForFnB: [false],
    complementaryDays: [0],
    sortOrder: [null as number | null, [Validators.min(0), Validators.max(20)]],
  });

  private readonly categoryId = toSignal(
    this.form.controls.hallCategoryId.valueChanges.pipe(
      startWith(this.form.controls.hallCategoryId.value),
    ),
    { initialValue: null },
  );
  /** As in SelfCare: an NTA hall has no VIP lounge, F&B, complementary days or order. */
  protected readonly isNta = computed(() =>
    isNtaCategory(this.categories().find((c) => c.id === this.categoryId())?.name),
  );

  constructor() {
    effect(() => this.applyNtaRule(this.isNta()));
  }

  ngOnInit(): void {
    const hall = this.hall();
    this.form.reset({
      name: hall.name,
      hallCategoryId: hall.hallCategory?.id ?? null,
      hallAreaCapacity: hall.hallAreaCapacity,
      isPopular: hall.isPopular,
      isVipLounge: hall.isVipLounge,
      isAvailableForFnB: hall.isAvailableForFnB,
      complementaryDays: hall.complementaryDays ? 1 : 0,
      sortOrder: hall.sortOrder,
    });
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }
    const changes = changedValues(this.form);
    if (!Object.keys(changes).length) {
      this.cancelled.emit();
      return;
    }
    this.saved.emit(changes);
  }

  private applyNtaRule(isNta: boolean): void {
    untracked(() => {
      const { isVipLounge, isAvailableForFnB, complementaryDays, sortOrder } = this.form.controls;
      const rest = [isVipLounge, isAvailableForFnB, complementaryDays, sortOrder];
      if (isNta) {
        isVipLounge.setValue(false, { emitEvent: false });
        isAvailableForFnB.setValue(false, { emitEvent: false });
        complementaryDays.setValue(0, { emitEvent: false });
        sortOrder.setValue(null, { emitEvent: false });
        // Dirty only where the hall had a value, so going NTA clears it on the hall too.
        const hall = this.hall();
        if (hall.isVipLounge) isVipLounge.markAsDirty();
        if (hall.isAvailableForFnB) isAvailableForFnB.markAsDirty();
        if (hall.complementaryDays) complementaryDays.markAsDirty();
        if (hall.sortOrder !== null) sortOrder.markAsDirty();
        rest.forEach((control) => control.disable({ emitEvent: false }));
      } else {
        rest.forEach((control) => control.enable({ emitEvent: false }));
      }
    });
  }
}
