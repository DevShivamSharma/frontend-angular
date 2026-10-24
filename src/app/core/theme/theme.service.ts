import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_KEY = 'ems.theme';

const isMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system';

/**
 * The colour theme: light, dark, or whatever the device uses. The choice is kept between visits
 * and put on the page as `data-theme`, which the styles (and PrimeNG) switch on.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly query = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  readonly mode = signal<ThemeMode>(this.stored());
  private readonly deviceIsDark = signal(this.query?.matches ?? false);
  /** What is shown: the chosen theme, or the device's when the choice is "system". */
  readonly resolved = computed<'light' | 'dark'>(() => {
    const mode = this.mode();
    return mode === 'system' ? (this.deviceIsDark() ? 'dark' : 'light') : mode;
  });

  constructor() {
    this.query?.addEventListener('change', (event) => this.deviceIsDark.set(event.matches));
    effect(() => {
      const root = this.document.documentElement;
      root.dataset['theme'] = this.resolved();
      root.style.colorScheme = this.resolved();
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Storage may be blocked; the theme still changes for this visit.
    }
  }

  private stored(): ThemeMode {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return isMode(value) ? value : 'system';
    } catch {
      return 'system';
    }
  }
}
