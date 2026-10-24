/** Production environment: every API is reached on the web app's own origin (gateway / reverse proxy). */
export const environment = {
  production: true,
  /** This portal's API (the EMS backend). */
  apiBaseUrl: '/ems/itpo/api/v1',
  /** ITPO's admin service: hall list, hall categories. */
  itpoAdminApiUrl: '/admin/itpo/api/v1',
  /** ITPO's user service: event list and event halls, organisations. */
  itpoUserApiUrl: '/user/itpo/api/v1',
  /** ITPO's stall service: a hall's layout. */
  itpoStallApiUrl: '/stall/itpo/api/v1',
};
