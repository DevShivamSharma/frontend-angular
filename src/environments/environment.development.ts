/**
 * Development environment, swapped in by the `development` build configuration (`ng serve`).
 * `/api` is forwarded to the local NestJS backend by proxy.conf.json, so the browser sees one
 * origin and the refresh cookie behaves exactly as in production.
 */
export const environment = {
  production: false,
  apiBaseUrl: '/api',
};
