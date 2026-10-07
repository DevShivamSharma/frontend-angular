/** Production API base URL, supplied by the build or served through /api. */
declare const APP_API_BASE_URL: string | undefined;

export const environment = {
  production: true,
  apiBaseUrl: typeof APP_API_BASE_URL !== 'undefined' ? APP_API_BASE_URL : '/api',
};
