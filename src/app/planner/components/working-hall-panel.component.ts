import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, viewChild } from '@angular/core';

import { NotifyService } from '../../core/notify.service';
import { ExcelLayoutService } from '../excel/excel-layout.service';
import { IconComponent } from './icon.component';
import { PlannerStore } from '../planner-store.service';

/**
 * Venue areas that are not exhibition halls (food courts, vending points, open areas, branding sites).
 * They stay on the server; the picker only lists the real halls. Names are compared trimmed and
 * case-insensitively.
 */
const NON_HALL_NAMES = [
  'PNG Nozzle',
  'F&B Vending Point',
  'F&B Outlet',
  'Hall 1A & Hall 1B',
  'Hall 2 & 3',
  'HN1 to HN4',
  'Branding Sites',
  'Horse Shoe F&B Outlet',
  'Open Area for Aahar',
  'Hangar 7A'
].map(name => name.toLowerCase());

/** The venue's main hall comes first in the picker. */
const FIRST_HALL_NAME = 'convention center';

/** Floors of one hall in walking order: no suffix, then ground, then first floor, then anything else (12A). */
const FLOOR_RANK: Record<string, number> = { '': 0, GF: 1, FF: 2 };

/**
 * Picker order: Convention Center, then halls by number and floor (Hall 2GF, 2FF, 3GF ... 11, 12, 12A, 14GF),
 * not alphabetically, which would put Hall 11 before Hall 2. "Hall 8-9-10" sorts by its first number.
 * Names that are not "Hall <number>..." (created or imported halls) follow, A to Z.
 */
function compareHalls(a: string, b: string): number {
  const nameA = a.trim().toLowerCase();
  const nameB = b.trim().toLowerCase();
  if (nameA === FIRST_HALL_NAME || nameB === FIRST_HALL_NAME) return Number(nameB === FIRST_HALL_NAME) - Number(nameA === FIRST_HALL_NAME);

  const partsA = /^hall\s+(\d+)(.*)$/i.exec(a.trim());
  const partsB = /^hall\s+(\d+)(.*)$/i.exec(b.trim());
  if (!partsA || !partsB) return partsA ? -1 : partsB ? 1 : a.localeCompare(b, undefined, { numeric: true });

  const byNumber = Number(partsA[1]) - Number(partsB[1]);
  if (byNumber) return byNumber;
  const suffixA = partsA[2].trim().toUpperCase();
  const suffixB = partsB[2].trim().toUpperCase();
  const byFloor = (FLOOR_RANK[suffixA] ?? 3) - (FLOOR_RANK[suffixB] ?? 3);
  return byFloor || suffixA.localeCompare(suffixB);
}

/**
 * "Working Hall" section: active hall picker, Excel import and template
 * download. App.js:583-585.
 */
@Component({
  selector: 'app-working-hall-panel',
  templateUrl: './working-hall-panel.component.html',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorkingHallPanelComponent {
  private readonly store = inject(PlannerStore);
  private readonly excel = inject(ExcelLayoutService);
  private readonly notify = inject(NotifyService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  /**
   * The halls the picker offers, in compareHalls() order. The active hall always stays in the list, even if
   * it is one of the excluded areas (e.g. a saved layout of one was opened), so the select never shows a blank value.
   */
  readonly halls = computed(() =>
    this.store
      .halls()
      .filter(h => !NON_HALL_NAMES.includes(h.name.trim().toLowerCase()) || this.isActive(h.id))
      .sort((a, b) => compareHalls(a.name, b.name))
  );
  readonly activeHallId = this.store.activeHallId;
  readonly hallsStatus = this.store.hallsStatus;

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
      this.notify.success(
        'Excel imported',
        `Hall: ${result.hall.name} · Stalls: ${result.valid.length}` +
          (rejected ? ` · Rejected outside boundary: ${rejected}` : '')
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
