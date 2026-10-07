import { inject } from '@angular/core';
import { CanActivateFn, RedirectCommand, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { httpStatus } from '../api/http-error';
import { AuthService } from '../auth/auth.service';
import { ThemeService } from '../theme/theme.service';
import { OrgApi } from './org-api.service';
import { OrgContextStore, PublicOrgStore } from './org.stores';

const invalidLink = (router: Router) =>
  new RedirectCommand(router.parseUrl('/invalid-link'), { skipLocationChange: true });

/**
 * First step for every `/<org>/...` URL: the slug must name an active organisation. Its look is
 * applied before any page renders, so another organisation's theme never flashes. An old slug
 * moves the browser to the current one; anything else shows the invalid-link page.
 */
export const organisationGuard: CanActivateFn = async (route, state) => {
  // Everything is injected before the first await: inject() only works synchronously.
  const router = inject(Router);
  const api = inject(OrgApi);
  const store = inject(PublicOrgStore);
  const context = inject(OrgContextStore);
  const theme = inject(ThemeService);
  const slug = route.paramMap.get('org') ?? '';

  if (store.config()?.slug === slug) {
    return true;
  }

  try {
    const config = await firstValueFrom(api.publicConfig(slug));
    if (config.slug !== slug) {
      const url = '/' + config.slug + state.url.slice(slug.length + 1);
      return new RedirectCommand(router.parseUrl(url), { replaceUrl: true });
    }
    store.config.set(config);
    context.context.set(null);
    theme.applyBranding(config.branding);
    return true;
  } catch (error) {
    if (httpStatus(error) === 404) {
      return invalidLink(router);
    }
    throw error;
  }
};

/** The organisation's workspace: signed in, and a member. */
export const organisationMemberGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const api = inject(OrgApi);
  const store = inject(OrgContextStore);
  const slug = route.paramMap.get('org') ?? '';

  if (!auth.signedIn()) {
    return router.createUrlTree(['/', slug, 'login'], { queryParams: { returnUrl: state.url } });
  }

  try {
    store.context.set(await firstValueFrom(api.context(slug)));
    return true;
  } catch (error) {
    switch (httpStatus(error)) {
      case 403:
        return router.createUrlTree(['/', slug, 'no-access']);
      case 404:
        return invalidLink(router);
      default:
        throw error;
    }
  }
};

/** A page inside the workspace that needs one permission. Without it, back to the home page. */
export function permissionGuard(permission: string): CanActivateFn {
  return (route) => {
    if (inject(OrgContextStore).can(permission)) {
      return true;
    }
    return inject(Router).createUrlTree(['/', route.paramMap.get('org') ?? '']);
  };
}

/** The platform console and the invalid-link page use the platform's own look. */
export const platformThemeGuard: CanActivateFn = () => {
  inject(PublicOrgStore).config.set(null);
  inject(OrgContextStore).context.set(null);
  inject(ThemeService).reset();
  return true;
};
