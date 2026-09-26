import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { Footprint, footprintRect, Violation } from '../geometry/placement-rules';
import { ServerViolation } from '../models/layout.model';
import { PlannerStore } from '../planner-store.service';
import { IconComponent } from './icon.component';

/**
 * "Placement rules" section: WHAT is wrong and WHERE, without reading logs.
 *
 *  - the placement just rejected (draw, move or edit), each broken rule with its ITPO
 *    reference, a Locate button, and the nearest valid spot with "Place here";
 *  - the violations the SERVER returned when a save/update was rejected;
 *  - the audit of the existing layout: problems in stalls that predate the rules, reported
 *    only (they never block loading or saving unchanged stalls).
 *
 * `section` splits it for the sidebar layout: the two alert cards stay above the tabs so a
 * rejection is never hidden behind another tab; the rules summary lives in the Rules tab.
 */
@Component({
  selector: 'app-violations-panel',
  templateUrl: './violations-panel.component.html',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ViolationsPanelComponent {
  private readonly store = inject(PlannerStore);

  readonly section = input<'alerts' | 'rules'>('alerts');

  readonly ruleDriven = this.store.ruleDriven;
  readonly rejection = this.store.rejection;
  readonly serverViolations = this.store.serverViolations;
  readonly audit = this.store.audit;
  readonly serverAudit = this.store.serverAudit;
  readonly hasSavedLayout = computed(() => this.store.selectedSavedId() !== null);
  /** A server audit is in flight: the button waits instead of firing a second request. */
  readonly auditing = signal(false);

  readonly rules = computed(() => {
    const ctx = this.store.placementContext();
    return ctx
      ? `${ctx.eventType}: ${ctx.rules.minPassageWidth[ctx.eventType]} m passages · ` +
          `${ctx.rules.peripheralClearance} m wall clearance · snap ${ctx.rules.snapStep} m`
          + '. Corner stalls need separation. Elsewhere, only back-to-back stalls may touch. Keep every open side clear.'
      : '';
  });

  readonly auditCount = computed(() => this.audit().reduce((n, e) => n + e.violations.length, 0));

  locate(violation: Violation, fallback?: Footprint): void {
    this.store.locate(violation.geometry, fallback);
  }

  locateServer(violation: ServerViolation): void {
    const stall = this.store.stallForServerViolation(violation);
    this.store.locate(violation.geometry, stall);
  }

  stallLabel(violation: ServerViolation): string {
    const stall = this.store.stallForServerViolation(violation);
    return violation.stallNumber ?? (stall ? `${stall.name} (unsaved)` : `Stall ${violation.stallIndex}`);
  }

  locateStall(stallId: string, violation: Violation): void {
    const stall = this.store.currentStalls().find(s => String(s.id) === stallId);
    this.store.locate(violation.geometry, stall);
    if (stall) this.store.selectStall(stall.id);
  }

  placeSuggestion(): void {
    this.store.acceptSuggestion();
  }

  showSuggestion(f: Footprint): void {
    this.store.locate([{ type: 'rect', rect: footprintRect(f) }]);
  }

  dismiss(): void {
    this.store.dismissFeedback();
  }

  async runServerAudit(): Promise<void> {
    this.auditing.set(true);
    try {
      await this.store.runServerAudit();
    } finally {
      this.auditing.set(false);
    }
  }

  /** "1 stall", "3 stalls". */
  plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }
}
