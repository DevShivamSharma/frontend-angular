import { Injectable } from '@angular/core';

import { StoredSession } from './auth.models';

/**
 * Where the session's tokens are kept between visits. An abstraction, so the auth code does not
 * depend on the browser's storage (and a test can supply a plain in-memory one).
 */
export abstract class TokenStorage {
  abstract read(): StoredSession | null;
  abstract write(session: StoredSession): void;
  abstract clear(): void;
}

const KEY = 'ems.session';

/** Keeps the tokens in localStorage. Storage can be blocked or full, so every access is guarded. */
@Injectable()
export class BrowserTokenStorage extends TokenStorage {
  read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      return typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string'
        ? {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            tokenExpires: Number(parsed.tokenExpires) || 0,
          }
        : null;
    } catch {
      return null;
    }
  }

  write(session: StoredSession): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      // The session then lasts until the tab is closed.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  }
}
