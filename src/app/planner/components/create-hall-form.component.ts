import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { HallShape } from '../models/hall.model';
import { HallFormValue, PlannerStore } from '../planner-store.service';
import { num } from '../geometry/planner-geometry';

/**
 * "Create Hall" section. App.js:529, App.js:586.
 *
 * Deliberately has no validators: React accepted any input and fell back to
 * defaults through `num()`, and Phase 6 requires that behaviour to be kept.
 */
@Component({
  selector: 'app-create-hall-form',
  templateUrl: './create-hall-form.component.html',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CreateHallFormComponent {
  private readonly store = inject(PlannerStore);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group({
    name: '',
    shape: 'SQUARE' as HallShape,
    w: 40,
    l: 40,
    r: 20
  });

  /** Drives the width/length vs radius switch in the template. */
  readonly shape = toSignal(this.form.controls.shape.valueChanges, {
    initialValue: this.form.controls.shape.value
  });

  createHall(): void {
    const raw = this.form.getRawValue();
    const value: HallFormValue = {
      name: raw.name,
      shape: raw.shape,
      w: num(raw.w, 40),
      l: num(raw.l, 40),
      r: num(raw.r, 20)
    };

    this.store.createHall(value);
  }
}
