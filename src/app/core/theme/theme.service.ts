import { DOCUMENT, inject, Injectable } from '@angular/core';

import type { FontFamily, OrganisationBranding } from '../api/api.models';
import { brandColorVariables, HEX_COLOR } from './material-theme';

/** The platform's own look, for the console and pages that belong to no organisation. */
export const PLATFORM_BRANDING: OrganisationBranding = {
  primaryColor: '#3949ab',
  accentColor: null,
  fontFamily: 'Inter',
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
};

const FONT_LINK_ID = 'org-font';
const DISPLAY_FONT_LINK_ID = 'display-font';
const DEFAULT_FAVICON = 'favicon.ico';

/**
 * Applies an organisation's branding to the whole app: Material colour tokens generated from
 * its seed colour, its font and its favicon. Components read only `--mat-sys-*` tokens, so a
 * new organisation needs no code.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private applied: string | null = null;

  applyBranding(branding: OrganisationBranding): void {
    const key = JSON.stringify(branding);
    if (key === this.applied) {
      return;
    }
    this.applied = key;

    const root = this.document.documentElement;
    this.applyTo(root, branding);
    this.loadFont(branding.fontFamily);
    this.loadDisplayFont();
    this.setFavicon(branding.faviconUrl);
  }

  reset(): void {
    this.applyBranding(PLATFORM_BRANDING);
  }

  /** Themes one element only: a live preview inside a settings form. */
  applyTo(
    element: HTMLElement,
    branding: Pick<OrganisationBranding, 'primaryColor' | 'accentColor' | 'fontFamily'>,
  ): void {
    const primary = HEX_COLOR.test(branding.primaryColor)
      ? branding.primaryColor
      : PLATFORM_BRANDING.primaryColor;
    for (const [name, value] of Object.entries(
      brandColorVariables(primary, branding.accentColor),
    )) {
      element.style.setProperty(name, value);
    }
    element.style.setProperty(
      '--app-font-family',
      `'${branding.fontFamily}', system-ui, sans-serif`,
    );
  }

  /** Fonts load on demand from Google Fonts; the system font shows until they arrive. */
  loadFont(family: FontFamily): void {
    const href =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}` +
      ':wght@400;500;600;700&display=swap';
    let link = this.document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = this.document.createElement('link');
      link.id = FONT_LINK_ID;
      link.rel = 'stylesheet';
      this.document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.href = href;
    }
  }

  /**
   * The display face of page and section titles, `--app-display-font`. Loaded once, with the
   * first branding, beside the organisation's own font, which it never replaces; text it lacks
   * falls back to the organisation's font.
   */
  private loadDisplayFont(): void {
    if (this.document.getElementById(DISPLAY_FONT_LINK_ID)) {
      return;
    }
    const link = this.document.createElement('link');
    link.id = DISPLAY_FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&display=swap';
    this.document.head.appendChild(link);
  }

  private setFavicon(url: string | null): void {
    const link = this.document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) {
      link.href = url ?? DEFAULT_FAVICON;
    }
  }
}
