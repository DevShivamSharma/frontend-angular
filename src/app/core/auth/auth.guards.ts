import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/** The platform console is for the Super Admin only. */
export const platformAdminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.user()?.isPlatformAdmin) {
    return true;
  }
  return inject(Router).createUrlTree(['/admin/login'], {
    queryParams: auth.signedIn() ? { denied: 1 } : { returnUrl: state.url },
  });
};

/** The console's sign-in page skips straight in when the Super Admin is already signed in. */
export const platformGuestGuard: CanActivateFn = () =>
  inject(AuthService).user()?.isPlatformAdmin ? inject(Router).parseUrl('/admin') : true;
