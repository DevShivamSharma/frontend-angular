import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';

import { NotifyService } from '../../core/notify.service';
import { PlannerStore } from '../planner-store.service';
import { IconComponent } from './icon.component';

/**
 * "SelfCare plan" section of the Hall tab: load a hall-layout API response (JSON) and apply it to
 * the hall of the same name, then optionally store it on the server hall.
 *
 * This is the direct route from the SelfCare payload to the planner: outline rectangles, zones,
 * gate labels, icon cards, north arrow and legend, exactly as the response carries them.
 */
@Component({
  selector: 'app-selfcare-import',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h3 class="panel-title">
        <app-icon class="icon-slot" name="upload" />
        SelfCare plan
      </h3>
      <div class="panel-hint">
        Load a hall-layout response (JSON). It replaces the plan of the hall with the same name.
      </div>
      <button type="button" class="btn-secondary is-block" (click)="pick()">
        <app-icon name="upload" [size]="14" />
        Import SelfCare layout
      </button>
      <button
        type="button"
        class="btn-secondary is-block"
        [disabled]="store.busy()"
        (click)="save()"
      >
        <app-icon name="save" [size]="14" />
        Save hall plan to server
      </button>
      <input
        #file
        type="file"
        accept=".json,application/json"
        hidden
        aria-hidden="true"
        tabindex="-1"
        (change)="onFile($event)"
      />
    </section>
  `,
})
export class SelfcareImportComponent {
  readonly store = inject(PlannerStore);
  private readonly notify = inject(NotifyService);
  private readonly file = viewChild.required<ElementRef<HTMLInputElement>>('file');

  pick(): void {
    this.file().nativeElement.click();
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const names = this.store.importSelfcare(JSON.parse(await file.text()));
      this.notify.success('SelfCare plan imported', names.join(', '));
    } catch (err) {
      this.store.showError(
        `❌ SelfCare Import Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      input.value = '';
    }
  }

  save(): void {
    void this.store.saveHallPlan();
  }
}
