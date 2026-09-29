import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'planner-setup.hallId';

/**
 * The hall chosen in step 1, shared by the setup steps.
 *
 * The URL (`?hall=`) is the source of truth, so a step can be bookmarked or reloaded; the
 * session copy only restores the choice when the user comes back through the sidebar.
 */
@Injectable({ providedIn: 'root' })
export class SetupState {
  readonly hallId = signal<string | null>(read());

  select(id: string | number | null): void {
    const value = id === null ? null : String(id);
    this.hallId.set(value);
    try {
      if (value === null) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage can be unavailable (private mode); the URL still carries the choice.
    }
  }
}

function read(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
