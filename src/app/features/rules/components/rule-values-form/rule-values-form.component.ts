import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { ValueLimit } from '../../data/rules.models';
import { limitRange, ValuesForm } from '../../domain/rule-values.form';

interface ValueField {
  id: string;
  /** The control's path in the form, e.g. `passageWidth.B2B`. */
  key: string;
  /** The control at that path; bound directly, since a name with a dot is a path and not a control name. */
  control: FormControl<number>;
  label: string;
  hint: string;
  min: number;
  max: number;
  suffix: string;
  step: number;
}

/** The numbers the rules use (widths, clearances, the share of the floor), each with its limits. */
@Component({
  selector: 'app-rule-values-form',
  imports: [ReactiveFormsModule, InputNumberModule, ToggleSwitchModule, FormFieldComponent],
  templateUrl: './rule-values-form.component.html',
  styleUrl: './rule-values-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuleValuesFormComponent {
  readonly form = input.required<ValuesForm>();
  readonly limits = input.required<readonly ValueLimit[]>();

  protected readonly fields = computed<ValueField[]>(() =>
    this.limits().map((limit) => {
      const form = this.form();
      const isShare = limit.unit === 'share';
      return {
        id: `value-${limit.key.replace('.', '-')}`,
        key: limit.key,
        control: form.get(limit.key) as FormControl<number>,
        label: limit.label,
        hint: `Allowed: ${limitRange(limit.unit, limit.min, limit.max)}`,
        min: isShare ? Math.round(limit.min * 100) : limit.min,
        max: isShare ? Math.round(limit.max * 100) : limit.max,
        suffix: isShare ? ' %' : ' m',
        step: isShare ? 5 : 0.5,
      };
    }),
  );
}
