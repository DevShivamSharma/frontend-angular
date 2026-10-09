import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';

import { dialogData, DialogRef } from '../../../core/ui/app-dialog.service';
import { IconComponent } from '../../../shared/icon.component';

export interface ScaleData {
  /** How many booths are selected. */
  count: number;
}

/** Asks how much to scale the selected booths by. Closes with the factor (1 = as they are). */
@Component({
  selector: 'app-scale-dialog',
  imports: [FormsModule, ButtonModule, InputNumberModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title head"><app-icon name="scale" /> Scale booths</h2>
    <div class="dialog-content stack">
      <label
        >Size (%)
        <p-inputnumber
          [ngModel]="percent()"
          (ngModelChange)="percent.set($event ?? 100)"
          [min]="10"
          [max]="1000"
          [showButtons]="true"
          [step]="10"
          suffix=" %"
        />
      </label>
      <p class="muted small">
        Each of the {{ data.count }} selected booths grows or shrinks about its middle; 100 % keeps
        it as it is.
      </p>
    </div>
    <div class="dialog-actions">
      <button pButton [text]="true" type="button" (click)="ref.close()">Cancel</button>
      <button
        pButton
        type="button"
        (click)="ref.close(percent() / 100)"
        [disabled]="percent() === 100"
      >
        Scale
      </button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .stack {
      display: grid;
      gap: 12px;
      min-width: min(320px, 84vw);
    }
    label {
      display: grid;
      gap: 4px;
      font: var(--app-label-medium);
    }
    :host ::ng-deep .p-inputnumber,
    :host ::ng-deep .p-inputnumber-input {
      width: 100%;
    }
    .small {
      margin: 0;
      font: var(--app-body-small);
    }
  `,
})
export class ScaleDialogComponent {
  protected readonly data = dialogData<ScaleData>();
  protected readonly ref = inject(DialogRef);

  protected readonly percent = signal(100);
}
