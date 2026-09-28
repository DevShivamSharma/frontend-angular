import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';

import { IconComponent } from '../components/icon.component';
import { PdfImportDialogComponent } from './pdf-import-dialog.component';

/**
 * "CAD plan (PDF)" section of the Hall tab. The import dialog, its geometry and pdf.js load only
 * when first asked for, so the planner itself does not grow.
 */
@Component({
  selector: 'app-pdf-import-card',
  imports: [IconComponent, PdfImportDialogComponent],
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
      <button type="button" class="btn-secondary is-block" (click)="open()">
        <app-icon name="upload" [size]="14" />
        Import PDF plan
      </button>
    </section>
    @defer (when requested()) {
      <app-pdf-import-dialog #dialog [openOnStart]="true" />
    }
  `,
})
export class PdfImportCardComponent {
  readonly requested = signal(false);
  // By name, not by class: a class reference here would load the dialog eagerly.
  private readonly dialog = viewChild<{ open(): void }>('dialog');

  open(): void {
    const dialog = this.dialog();
    if (dialog) dialog.open();
    else this.requested.set(true);
  }
}
