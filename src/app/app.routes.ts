import { Router, Routes } from '@angular/router';
import { inject } from '@angular/core';

import { HomePageComponent } from './home/home-page.component';

/**
 * The root shows the 3D venue model. `/planner` is the stall-planner setup: step 1 selects (or
 * imports) a hall, step 2 sets its plotting rules, step 3 is the stall editor. The planner
 * screens are lazy-loaded so the venue page does not download them. The wildcard only provides
 * SPA fallback parity; no guards are added until authentication requirements exist.
 */
export const routes: Routes = [
  {
    path: 'planner/pdf',
    redirectTo: ({ queryParams }) => inject(Router).createUrlTree(['/planner/editor'], {
      queryParams: { ...queryParams, import: 'pdf' }
    })
  },
  { path: 'hall14-detail', title: 'Hall 14 — detail study', loadComponent: () => import('./home/hall14-study.component').then(m => m.Hall14StudyComponent) },
  { path: 'planner/pricing', title: 'Hall pricing library', loadComponent: () => import('./planner/pricing/pricing-library.component').then(m => m.PricingLibraryComponent) },
  { path: '', component: HomePageComponent },
  // Step 3, the stall editor, full screen. Listed before the setup routes so `planner/editor`
  // is never taken for a setup step. Opened with `?hallId=` from "Start creating".
  {
    path: 'planner/editor',
    title: 'Stall planner',
    loadComponent: () => import('./planner/planner-page.component').then(m => m.PlannerPageComponent),
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()]
  },
  // Step 3 for architects: the AutoCAD-like 2D drafting workspace. The 3D editor above stays as
  // its preview. Opened with `?hallId=` or `?layoutId=`.
  {
    path: 'planner/draft',
    title: 'Drafting · Stall planner',
    loadComponent: () => import('./planner/drafting/drafting-page.component').then(m => m.DraftingPageComponent)
  },
  // The exhibitor-facing view of a saved layout: the stall map, availability and booking.
  // Opened with `?layoutId=` from a saved layout's View button.
  {
    path: 'planner/view',
    title: 'Stall map',
    loadComponent: () => import('./planner/exhibitor-view/exhibitor-view-page.component').then(m => m.ExhibitorViewPageComponent)
  },
  {
    path: 'planner',
    loadComponent: () => import('./setup/setup-shell.component').then(m => m.SetupShellComponent),
    children: [
      // Keeps the venue map's `/planner?hall=11&floor=GF` links working: the query survives.
      { path: '', pathMatch: 'full', redirectTo: 'halls' },
      {
        path: 'halls',
        title: 'Select a hall · Stall planner',
        loadComponent: () => import('./setup/hall-select-page.component').then(m => m.HallSelectPageComponent)
      },
      {
        path: 'halls/import',
        title: 'Import a hall · Stall planner',
        loadComponent: () => import('./setup/hall-import-page.component').then(m => m.HallImportPageComponent)
      },
      {
        path: 'rules',
        title: 'Plotting rules · Stall planner',
        loadComponent: () => import('./setup/rules-page.component').then(m => m.RulesPageComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
