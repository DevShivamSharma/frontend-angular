import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';

import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';

export interface ScaleData {
  /** How many booths are selected. */
  count: number;
}

/** Asks how much to scale the selected booths by. Closes with the factor (1 = as they are). */
@Component({
  selector: 'app-scale-dialog',
  imports: [FormsModule, ButtonModule, InputNumberModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scale-dialog.component.html',
  styleUrl: './scale-dialog.component.scss',
})
export class ScaleDialogComponent {
  protected readonly data = dialogData<ScaleData>();
  protected readonly ref = inject(DialogRef);

  protected readonly percent = signal(100);
}
