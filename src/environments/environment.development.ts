/**
 * Development environment, swapped in by the `development` build configuration (`ng serve`).
 * It talks to the staging gateway directly, which allows the browser's cross-origin calls.
 * For a backend on this machine, point `apiBaseUrl` at 'http://localhost:3010/ems/itpo/api/v1'
 * (that backend does not send CORS headers, so it needs a proxy).
 */
const gateway = 'https://stgapi.bmitpo.com';

export const environment = {
  production: false,
  apiBaseUrl: `${gateway}/ems/itpo/api/v1`,
  itpoAdminApiUrl: `${gateway}/admin/itpo/api/v1`,
  itpoUserApiUrl: `${gateway}/user/itpo/api/v1`,
  itpoStallApiUrl: `${gateway}/stall/itpo/api/v1`,
};
