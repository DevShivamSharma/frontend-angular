import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';

import { ExcelLayoutService } from '../excel/excel-layout.service';
import { PlannerStore } from '../planner-store.service';

/**
 * "Working Hall" section: active hall picker, Excel import and template
 * download. App.js:583-585.
 */
@Component({
  selector: 'app-working-hall-panel',
  templateUrl: './working-hall-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorkingHallPanelComponent {
  private readonly store = inject(PlannerStore);
  private readonly excel = inject(ExcelLayoutService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  readonly halls = this.store.halls;
  readonly activeHallId = this.store.activeHallId;

  /**
   * Drives `[selected]` on each option. The select's own `[value]` binding is not
   * enough: when a hall is added and made active in the same tick (open saved
   * layout, Generate Hall, Excel import), `[value]` is applied before the new
   * `<option>` exists and the browser silently keeps the old selection.
   */
  isActive(hallId: string | number): boolean {
    return String(hallId) === String(this.activeHallId());
  }

  /**
   * The select always reports a string, which is why every id comparison in
   * the store goes through `String()`. React behaves the same way.
   */
  onHallChange(value: string): void {
    this.store.setActiveHall(value);
  }

  openFilePicker(): void {
    this.fileInput().nativeElement.click();
  }

  downloadTemplate(): void {
    this.excel.downloadTemplate();
  }

  /** App.js:531-545. */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const result = this.excel.parse(await file.arrayBuffer());
      this.store.applyExcelImport(result);

      const rejected = result.imported.length - result.valid.length;
      window.alert(
        `✅ Excel imported\nHall: ${result.hall.name}\nStalls: ${result.valid.length}` +
          (rejected ? `\nRejected outside boundary: ${rejected}` : '')
      );
    } catch (err) {
      this.store.showError(
        `❌ Excel Import Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // Allows re-importing the same file twice in a row.
      input.value = '';
    }
  }
}
