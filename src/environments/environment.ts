/**
 * Production environment (the default; `ng build` uses this file).
 *
 * The published deployment serves this SPA and the NestJS API from the same origin (the
 * backend serves the Angular build and forwards everything outside /api and /health to
 * index.html), so a relative base URL is correct and needs no per-deploy edit.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api'
};
