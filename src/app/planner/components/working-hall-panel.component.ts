import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';

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
  styleUrl: './working-hall-panel.component.css',
  imports: [IconComponent],
  host: { '(window:resize)': 'positionPicker()' },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorkingHallPanelComponent {
  private readonly store = inject(PlannerStore);
  private readonly excel = inject(ExcelLayoutService);
  private readonly notify = inject(NotifyService);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('hallTrigger');
  private readonly picker = viewChild.required<ElementRef<HTMLElement>>('hallPicker');
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('hallSearch');
  private readonly options = viewChild.required<ElementRef<HTMLElement>>('hallOptions');
  private readonly injector = inject(Injector);
  readonly pickerOpen = signal(false);
  readonly query = signal('');
  readonly highlighted = signal(0);
  readonly pickerPosition = signal({ left: 0, top: 0, width: 300, maxHeight: 360 });

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
  readonly currentHall = this.store.currentHall;
  readonly filteredHalls = computed(() => {
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.halls().filter(hall => words.every(word => hall.name.toLowerCase().includes(word)));
  });
  readonly activeOption = computed(() => this.filteredHalls()[this.highlighted()] ? `hall-option-${this.highlighted()}` : null);

  /**
   * Compare IDs as strings so imported halls and saved copies retain their selection.
   */
  isActive(hallId: string | number): boolean {
    return String(hallId) === String(this.activeHallId());
  }

  /** Selection follows the same store path as the original hall select. */
  onHallChange(value: string): void {
    this.store.setActiveHall(value);
  }

  onBeforePickerToggle(event: Event): void {
    if ((event as ToggleEvent).newState !== 'open') return;
    this.query.set('');
    this.highlighted.set(Math.max(0, this.halls().findIndex(hall => this.isActive(hall.id))));
    this.pickerOpen.set(true);
    this.positionPicker();
    afterNextRender(() => {
      if (!this.pickerOpen()) return;
      this.search().nativeElement.focus({ preventScroll: true });
      this.scrollToHighlight();
    }, { injector: this.injector });
  }

  onPickerToggle(event: Event): void {
    this.pickerOpen.set((event as ToggleEvent).newState === 'open');
  }

  closePicker(restoreFocus = true): void {
    this.picker().nativeElement.hidePopover();
    this.pickerOpen.set(false);
    if (restoreFocus) this.trigger().nativeElement.focus({ preventScroll: true });
  }

  chooseHall(id: string | number): void {
    if (!this.isActive(id)) this.onHallChange(String(id));
    this.closePicker();
  }

  filterHalls(value: string): void {
    this.query.set(value);
    this.highlighted.set(0);
    this.options().nativeElement.scrollTop = 0;
  }

  onTriggerKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (!this.pickerOpen()) this.picker().nativeElement.showPopover();
  }

  onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      this.closePicker();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hall = this.filteredHalls()[this.highlighted()];
      if (hall) this.chooseHall(hall.id);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = this.filteredHalls().length;
      if (!count) return;
      this.highlighted.update(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
      this.scrollToHighlight();
    }
  }

  private scrollToHighlight(): void {
    this.options().nativeElement.children[this.highlighted()]?.scrollIntoView({ block: 'nearest' });
  }

  positionPicker(): void {
    if (!this.pickerOpen()) return;
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const openAbove = below < 220 && above > below;
    const maxHeight = Math.min(360, Math.max(100, openAbove ? above : below));
    this.pickerPosition.set({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: openAbove ? rect.top - maxHeight - 8 : rect.bottom + 8,
      width, maxHeight
    });
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
