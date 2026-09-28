import { Injectable } from '@angular/core';

export const PLANNER_TOUR_STORAGE_KEY = 'stall-planner.guided-tour.v1';

/** Browser-local onboarding preference; no layout or account data is stored. */
@Injectable({ providedIn: 'root' })
export class PlannerTourState {
  private dismissedInMemory = false;

  hasSeen(): boolean {
    if (this.dismissedInMemory) return true;
    for (const kind of ['localStorage', 'sessionStorage'] as const) {
      try {
        if (window[kind].getItem(PLANNER_TOUR_STORAGE_KEY)) return true;
      } catch { /* Restricted storage must not break the planner. */ }
    }
    return false;
  }

  remember(outcome: 'completed' | 'skipped'): void {
    this.dismissedInMemory = true;
    for (const kind of ['localStorage', 'sessionStorage'] as const) {
      try { window[kind].setItem(PLANNER_TOUR_STORAGE_KEY, outcome); }
      catch { /* The in-memory preference still survives route changes. */ }
    }
  }
}
