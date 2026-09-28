import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconComponent } from '../components/icon.component';
import { PlannerStore } from '../planner-store.service';

/** "CAD plan (PDF)" section of the Hall tab: opens the plan import (hosted by the planner page). */
@Component({
  selector: 'app-pdf-import-card',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h3 class="panel-title">
        <app-icon class="icon-slot" name="file" />
        CAD plan (PDF)
      </h3>
      <div class="panel-hint">
        Read the stalls of an AutoCAD hall plan, L-shapes included. You review and place them
        before anything changes.
      </div>
      <button type="button" class="btn-secondary is-block" (click)="store.openPdfImport()">
        <app-icon name="upload" [size]="14" />
        Import PDF plan
      </button>
    </section>
  `,
})
export class PdfImportCardComponent {
  readonly store = inject(PlannerStore);
}
