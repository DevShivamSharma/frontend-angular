import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { num, validGate } from '../geometry/planner-geometry';
import { GATE_SIDES } from './gate-sides';
import { IconComponent } from './icon.component';
import { GateSide } from '../models/stall.model';
import { NewStallValue, PlannerStore } from '../planner-store.service';

/**
 * "Add Shop" section. App.js:517-527, App.js:587-590.
 *
 * The store finds the first free grid position; this component only collects
 * the form values and advances the default shop name afterwards.
 */
@Component({
  selector: 'app-add-stall-form',
  templateUrl: './add-stall-form.component.html',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddStallFormComponent {
  private readonly store = inject(PlannerStore);
  private readonly fb = inject(FormBuilder);

  readonly gateSides = GATE_SIDES;

  readonly form = this.fb.nonNullable.group({
    name: '',
    width: 8,
    length: 8,
    height: 4,
    color: '#3498db',
    gateSide: 'FRONT' as GateSide
  });

  readonly gateSide = toSignal(this.form.controls.gateSide.valueChanges, {
    initialValue: this.form.controls.gateSide.value
  });

  setGateSide(value: GateSide): void {
    this.form.controls.gateSide.setValue(validGate(value));
  }

  addStall(): void {
    // React reads the pre-add count for both the fallback name and the next
    // default name, so it is captured before the store mutates.
    const countBefore = this.store.currentStalls().length;
    const raw = this.form.getRawValue();

    const value: NewStallValue = {
      name: raw.name,
      width: num(raw.width, 5),
      length: num(raw.length, 5),
      height: num(raw.height, 4),
      color: raw.color,
      gateSide: raw.gateSide
    };

    if (!this.store.addStall(value)) return;

    this.form.controls.name.setValue(`Shop ${countBefore + 2}`);
  }
}
