import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { EVENT_TYPES } from '../geometry/placement-rules';
import { EventType } from '../models/hall.model';
import { GateSide } from '../models/stall.model';
import { EditorMode, PlannerStore } from '../planner-store.service';
import { IconComponent } from './icon.component';

/**
 * The editor toolbar over the 3D stage: Select / Draw mode, the stall size to draw, and - for a
 * rule-driven hall - the event type (passage width) and the clearance / free-space layers.
 *
 * Stall sizes come from GET /api/stall-types; nothing here knows 3x2 or 10x10.
 *
 * Draw mode has three ways out: the Cancel button, the active size clicked again, and Esc.
 * Esc is a document listener because the 3D canvas never takes focus, so a keydown binding
 * on the toolbar or the stage would not fire while the user is drawing.
 */
@Component({
  selector: 'app-editor-toolbar',
  templateUrl: './editor-toolbar.component.html',
  styleUrl: './editor-toolbar.component.css',
  imports: [IconComponent],
  host: { '(document:keydown.escape)': 'onEscape()' },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorToolbarComponent {
  private readonly store = inject(PlannerStore);

  readonly eventTypes = EVENT_TYPES;
  readonly mode = this.store.mode;
  readonly stallTypes = this.store.stallTypes;
  readonly selectedStallTypeId = this.store.selectedStallTypeId;
  readonly eventType = this.store.eventType;
  readonly passageWidth = this.store.passageWidth;
  readonly draftOpenSide = this.store.draftOpenSide;
  readonly ruleDriven = this.store.ruleDriven;
  readonly showClearances = this.store.showClearances;
  readonly showFreeSpace = this.store.showFreeSpace;

  /** Passage width of each event type for the current hall, e.g. "B2B · 3 m". */
  readonly passageLabel = computed(() => {
    const rules = this.store.placementContext()?.rules;
    return (type: EventType): string => (rules ? `${type} · ${rules.minPassageWidth[type]} m passage` : type);
  });

  /** "N positions fit" for the free-space toggle. */
  readonly freeCount = computed(() => this.store.freeSpace()?.length ?? null);

  readonly freeSizeLabel = computed(() => {
    const type = this.store.selectedStallType() ?? this.stallTypes()[0];
    return type ? `${type.width} × ${type.height}` : '3 × 2';
  });

  setMode(mode: EditorMode): void {
    this.store.setMode(mode);
  }

  selectType(id: string | null): void {
    // The size already being drawn, clicked again, is a toggle: back to Select.
    if (this.mode() === 'draw' && this.selectedStallTypeId() === id) {
      this.cancelDraw();
      return;
    }
    this.store.selectStallType(id);
    this.store.setMode('draw');
  }

  /** Same as pressing Select: drops the draft, and the scene ends any drag in progress. */
  cancelDraw(): void {
    this.store.setMode('select');
  }

  onEscape(): void {
    if (this.mode() === 'draw') this.cancelDraw();
  }

  setEventType(value: string): void {
    this.store.setEventType(value === 'B2C' ? 'B2C' : 'B2B');
  }

  setPassageWidth(input: HTMLInputElement): void {
    this.store.setPassageWidth(input.valueAsNumber);
    input.value = String(this.passageWidth());
  }

  setDraftOpenSide(value: string): void {
    this.store.setDraftOpenSide(value as GateSide);
  }

  toggleClearances(checked: boolean): void {
    this.store.setShowClearances(checked);
  }

  toggleFreeSpace(checked: boolean): void {
    this.store.setShowFreeSpace(checked);
  }
}
