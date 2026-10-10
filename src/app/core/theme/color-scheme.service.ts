import { DOCUMENT, computed, effect, inject, Injectable, signal } from '@angular/core';

export type ColorScheme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'vpColorScheme';
/** On the root while dark: PrimeNG's dark mode selector (see app.config). */
export const DARK_CLASS = 'app-dark';

/**
 * Light, dark, or as the device is. Our `--app-*` tokens are `light-dark()` pairs, which follow
 * the root's `color-scheme`; PrimeNG follows the {@link DARK_CLASS} class. Both are set here,
 * and the choice is kept in this browser.
 */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly deviceDark = signal(this.media?.matches ?? false);

  readonly scheme = signal<ColorScheme>(read());
  readonly dark = computed(() =>
    this.scheme() === 'system' ? this.deviceDark() : this.scheme() === 'dark',
  );

  constructor() {
    this.media?.addEventListener('change', (e) => this.deviceDark.set(e.matches));
    effect(() => {
      const dark = this.dark();
      const root = this.document.documentElement;
      root.style.colorScheme = dark ? 'dark' : 'light';
      root.classList.toggle(DARK_CLASS, dark);
    });
  }

  set(scheme: ColorScheme): void {
    this.scheme.set(scheme);
    try {
      if (scheme === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, scheme);
    } catch {
      // Storage refused: the choice lasts until the page closes.
    }
  }
}

function read(): ColorScheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}
