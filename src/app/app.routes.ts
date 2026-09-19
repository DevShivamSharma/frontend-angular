import { Routes } from '@angular/router';

import { PlannerPageComponent } from './planner/planner-page.component';

/**
 * One route, matching the React app's single screen (decision FD-002).
 * The wildcard only provides SPA fallback parity; no guards are added until
 * authentication requirements exist.
 */
export const routes: Routes = [
  { path: '', component: PlannerPageComponent },
  { path: '**', redirectTo: '' }
];
