import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { EMPTY, switchMap } from 'rxjs';

/**
 * A form control with a visible label, an optional hint, and its error under it (in the control's
 * own words, once the user has touched it). The input goes inside as content.
 */
@Component({
  selector: 'app-form-field',
  templateUrl: './form-field.component.html',
  styleUrl: './form-field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormFieldComponent {
  readonly label = input.required<string>();
  /** The id of the input inside, so the label points at it. */
  readonly inputId = input.required<string>();
  readonly hint = input<string>();
  readonly required = input(false, { transform: booleanAttribute });
  /** The control whose errors this field shows. */
  readonly control = input<AbstractControl | null>(null);

  // Re-evaluates the error whenever the control changes (value, status, touched).
  private readonly controlEvents = toSignal(
    toObservable(this.control).pipe(switchMap((control) => (control ? control.events : EMPTY))),
  );

  protected readonly error = computed(() => {
    this.controlEvents();
    const control = this.control();
    return control && (control.touched || control.dirty) && control.errors
      ? messageFor(control.errors)
      : null;
  });

  protected readonly errorId = computed(() => `${this.inputId()}-error`);
}

function messageFor(errors: ValidationErrors): string {
  if (typeof errors['server'] === 'string') return errors['server'];
  if (errors['required']) return 'This field is required.';
  if (errors['email']) return 'Enter a valid email address.';
  if (errors['min']) return `Must be at least ${errors['min'].min}.`;
  if (errors['max']) return `Must be at most ${errors['max'].max}.`;
  if (errors['minlength']) return `Use at least ${errors['minlength'].requiredLength} characters.`;
  if (errors['maxlength']) return `Use at most ${errors['maxlength'].requiredLength} characters.`;
  if (errors['pattern']) return 'This value is not in the right format.';
  if (typeof errors['message'] === 'string') return errors['message'];
  return 'This value is not valid.';
}
