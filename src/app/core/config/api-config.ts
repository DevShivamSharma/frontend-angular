import { InjectionToken } from '@angular/core';

import { environment } from '../../../environments/environment';

/** The base URLs of the APIs the portal talks to. Injected, so a test or a build can swap them. */
export interface ApiConfig {
  /** This portal's own API. */
  ems: string;
  /** ITPO's admin service. */
  itpoAdmin: string;
  /** ITPO's user service. */
  itpoUser: string;
  /** ITPO's stall service (a hall's layout). */
  itpoStall: string;
}

export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG', {
  providedIn: 'root',
  factory: () => ({
    ems: environment.apiBaseUrl,
    itpoAdmin: environment.itpoAdminApiUrl,
    itpoUser: environment.itpoUserApiUrl,
    itpoStall: environment.itpoStallApiUrl,
  }),
});
