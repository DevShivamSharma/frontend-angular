import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { LayoutSummary } from '../models/layout.model';
import { IconComponent } from './icon.component';
import { PlannerStore } from '../planner-store.service';

/** "Saved Layout" section: name, save/update, refresh and the list. App.js:593. */
@Component({
  selector: 'app-saved-layouts-panel',
  templateUrl: './saved-layouts-panel.component.html',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SavedLayoutsPanelComponent {
  private readonly store = inject(PlannerStore);

  readonly savedLayouts = this.store.savedLayouts;
  readonly selectedSavedId = this.store.selectedSavedId;
  readonly busy = this.store.busy;

  /**
   * The layout name is store-owned because creating a hall, importing a
   * workbook and opening a layout all overwrite it (App.js:529, 544, 575).
   */
  readonly layoutName = new FormControl('', { nonNullable: true });

  constructor() {
    this.layoutName.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.store.setLayoutName(value));

    effect(() => {
      const value = this.store.layoutName();
      if (this.layoutName.value !== value) {
        this.layoutName.setValue(value, { emitEvent: false });
      }
    });
  }

  /** Falls back through the shapes the backend list endpoint may return. */
  stallCount(layout: LayoutSummary): number {
    return layout.stallCount ?? layout.stalls?.length ?? 0;
  }

  saveLayout(): void {
    void this.store.saveLayout();
  }

  updateLayout(): void {
    void this.store.updateLayout();
  }

  refresh(): void {
    void this.store.loadList();
  }

  openLayout(id: string | number): void {
    void this.store.openLayout(id);
  }

  deleteLayout(id: string | number): void {
    void this.store.deleteLayout(id);
  }
}
