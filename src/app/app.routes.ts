import { Routes } from '@angular/router';

import { HomePageComponent } from './home/home-page.component';
import { PlannerPageComponent } from './planner/planner-page.component';

/**
 * The root shows the 3D venue model; the planner (previously the only screen,
 * decision FD-002) moved to `/planner`. The wildcard only provides SPA
 * fallback parity; no guards are added until authentication requirements exist.
 */
export const routes: Routes = [
  { path: '', component: HomePageComponent },
  { path: 'planner', component: PlannerPageComponent },
  // The architect's 2D drafting workspace on the same planner state.
  {
    path: 'draft',
    loadComponent: () => import('./planner/drafting/drafting-page.component').then(m => m.DraftingPageComponent)
  },
  { path: '**', redirectTo: '' }
];
