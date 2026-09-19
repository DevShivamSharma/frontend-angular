import { InjectionToken } from '@angular/core';

/**
 * Base URL of the floorplan API.
 *
 * The React app hardcodes this at `frontend/src/App.js:8`. Decision FD-007 keeps
 * the same local default but moves it behind a token so a deployment can
 * override it in `app.config.ts` without touching components.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8080/api'
});
