/**
 * Production environment (the default; `ng build` uses this file).
 *
 * `apiBaseUrl` must be the deployed backend's HTTPS URL including `/api`. It is deliberately an
 * unusable placeholder until the demo backend exists, so a build made without setting it fails
 * loudly in the browser instead of silently calling someone's localhost.
 */
export const environment = {
  production: true,
  apiBaseUrl: 'https://REPLACE-AT-DEPLOY.invalid/api'
};
