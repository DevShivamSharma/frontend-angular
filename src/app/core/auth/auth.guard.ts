import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/** Signed-in users only; anyone else goes to the sign-in page and comes back afterwards. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.isAuthenticated()
    ? true
    : inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** ITPO staff only; an organiser is sent to the events they may see. */
export const staffGuard: CanActivateFn = () => {
  return inject(AuthService).isStaff() ? true : inject(Router).createUrlTree(['/external-events']);
};

/** The sign-in page is for visitors; someone already signed in goes on to the portal. */
export const guestGuard: CanActivateFn = () => {
  return inject(AuthService).isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
};
