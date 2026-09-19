/**
 * Development environment. Swapped in for `environment.ts` by the `fileReplacements` entry of
 * the `development` build configuration in angular.json (used by `ng serve`).
 *
 * Points at the local NestJS backend (`backend-nest`, port 8080).
 */
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080/api'
};
