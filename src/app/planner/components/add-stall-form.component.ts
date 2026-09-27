import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import { num, validGate } from '../geometry/planner-geometry';
import { GATE_COMPASS, GATE_SIDES } from './gate-sides';
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
  readonly gateCompass = GATE_COMPASS;

  /** Presets for the colour most shops get; the native picker stays for everything else. */
  readonly palette = ['#3498db', '#0d9488', '#7c3aed', '#d97706', '#e11d48', '#15803d', '#475569'];

  readonly form = this.fb.nonNullable.group({
    name: '',
    width: 8,
    length: 8,
    height: 4,
    color: '#3498db',
    gateSide: 'FRONT' as GateSide
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue()
  });

  readonly gateSide = computed(() => validGate(this.value().gateSide));

  readonly gateLabel = computed(
    () => GATE_SIDES.find(entry => entry[0] === this.gateSide())?.[1] ?? 'Front (+Z)'
  );

  /** What the three number fields and the colour add up to, so the size is checked before adding. */
  readonly preview = computed(() => {
    const raw = this.value();
    const width = num(raw.width, 5);
    const length = num(raw.length, 5);
    return {
      width,
      length,
      height: num(raw.height, 4),
      area: Math.round(width * length * 10) / 10,
      color: raw.color ?? '#3498db'
    };
  });

  setGateSide(value: GateSide): void {
    this.form.controls.gateSide.setValue(validGate(value));
  }

  setColor(value: string): void {
    this.form.controls.color.setValue(value);
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
