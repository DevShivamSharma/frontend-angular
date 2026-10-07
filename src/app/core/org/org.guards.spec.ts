import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  provideRouter,
  RedirectCommand,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import type { PublicConfig } from '../api/api.models';
import { ThemeService } from '../theme/theme.service';
import { OrgApi } from './org-api.service';
import { organisationGuard } from './org.guards';
import { PublicOrgStore } from './org.stores';

const config: PublicConfig = {
  slug: 'bharat-mandapam',
  name: 'Bharat Mandapam',
  branding: {
    primaryColor: '#0b5394',
    accentColor: null,
    fontFamily: 'Inter',
    logoUrl: null,
    logoDarkUrl: null,
    faviconUrl: null,
  },
  locale: { defaultLanguage: 'en', languages: ['en'] },
};

describe('organisationGuard', () => {
  let api: jasmine.SpyObj<OrgApi>;
  let theme: jasmine.SpyObj<ThemeService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<OrgApi>('OrgApi', ['publicConfig']);
    theme = jasmine.createSpyObj<ThemeService>('ThemeService', ['applyBranding']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: OrgApi, useValue: api },
        { provide: ThemeService, useValue: theme },
      ],
    });
  });

  function run(slug: string, url: string) {
    const route = { paramMap: convertToParamMap({ org: slug }) } as ActivatedRouteSnapshot;
    const state = { url } as RouterStateSnapshot;
    return TestBed.runInInjectionContext(() => organisationGuard(route, state)) as Promise<
      boolean | RedirectCommand
    >;
  }

  it('applies the organisation’s look and lets the page open', async () => {
    api.publicConfig.and.returnValue(of(config));

    expect(await run('bharat-mandapam', '/bharat-mandapam/login')).toBeTrue();
    expect(theme.applyBranding).toHaveBeenCalledWith(config.branding);
    expect(TestBed.inject(PublicOrgStore).config()).toEqual(config);
  });

  it('moves an old slug to the current one, keeping the rest of the URL', async () => {
    api.publicConfig.and.returnValue(of(config));

    const result = await run('itpo', '/itpo/team?tab=2');

    expect(result).toBeInstanceOf(RedirectCommand);
    const target = TestBed.inject(Router).serializeUrl(
      (result as RedirectCommand).redirectTo as never,
    );
    expect(target).toBe('/bharat-mandapam/team?tab=2');
  });

  it('shows the invalid-link page for an unknown or suspended organisation', async () => {
    api.publicConfig.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    const result = await run('nowhere', '/nowhere');

    expect(result).toBeInstanceOf(RedirectCommand);
    const target = TestBed.inject(Router).serializeUrl(
      (result as RedirectCommand).redirectTo as never,
    );
    expect(target).toBe('/invalid-link');
    expect(theme.applyBranding).not.toHaveBeenCalled();
  });
});
