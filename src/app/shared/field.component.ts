import { ChangeDetectionStrategy, Component, contentChild, input } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * A labelled form control: the label above (tied to the control by `for`), the projected
 * control, and below it the error once the control is invalid and touched, else the hint.
 *
 *   <app-field label="Name" for="ev-name" error="2 to 160 characters">
 *     <input pInputText id="ev-name" formControlName="name" />
 *   </app-field>
 */
@Component({
  selector: 'app-field',
  // Not OnPush: the error follows the projected control's state, which no input carries.
  changeDetection: ChangeDetectionStrategy.Default,
  host: { class: 'field' },
  template: `
    @if (label()) {
      <label [attr.for]="for()">{{ label() }}</label>
    }
    <ng-content />
    @if (error() && invalid) {
      <small class="field-error" role="alert">{{ error() }}</small>
    } @else if (hint()) {
      <small class="field-hint">{{ hint() }}</small>
    }
    <ng-content select="[fieldNote]" />
  `,
})
export class FieldComponent {
  readonly label = input<string>('');
  /** The id of the control the label names. */
  readonly for = input<string | null>(null);
  readonly hint = input<string | null>(null);
  /** Shown while the projected control is invalid and touched. */
  readonly error = input<string | null>(null);

  private readonly control = contentChild(NgControl, { descendants: true });

  /** Read on every check, since control state is not a signal. */
  protected get invalid(): boolean {
    const c = this.control();
    return Boolean(c?.invalid && (c.touched || c.dirty));
  }
}
