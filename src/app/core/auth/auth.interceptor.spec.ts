import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { API_BASE_URL } from '../api/api-base.token';
import { authInterceptor, signInUrl } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['accessToken', 'refresh']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('adds the access token to API calls only', () => {
    auth.accessToken.and.returnValue('token-1');

    http.get('/api/orgs/itpo/members').subscribe();
    http.get('https://fonts.googleapis.com/css2').subscribe();

    expect(backend.expectOne('/api/orgs/itpo/members').request.headers.get('Authorization')).toBe(
      'Bearer token-1',
    );
    expect(
      backend.expectOne('https://fonts.googleapis.com/css2').request.headers.has('Authorization'),
    ).toBeFalse();
  });

  it('sends cookies, and no token, to the session calls', () => {
    auth.accessToken.and.returnValue('token-1');

    http.post('/api/auth/refresh', {}).subscribe();

    const request = backend.expectOne('/api/auth/refresh').request;
    expect(request.withCredentials).toBeTrue();
    expect(request.headers.has('Authorization')).toBeFalse();
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    let token = 'old';
    auth.accessToken.and.callFake(() => token);
    auth.refresh.and.callFake(async () => {
      token = 'new';
      return true;
    });

    const result = new Promise((resolve) => http.get('/api/auth/me').subscribe(resolve));
    backend.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    await Promise.resolve();

    const retry = backend.expectOne('/api/auth/me');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    retry.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('sends the user to sign in when the session cannot be refreshed', async () => {
    auth.accessToken.and.returnValue('old');
    auth.refresh.and.resolveTo(false);
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

    const failed = new Promise((resolve) => http.get('/api/auth/me').subscribe({ error: resolve }));
    backend.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await failed;

    expect(navigate).toHaveBeenCalled();
  });
});

describe('signInUrl', () => {
  it('sends console pages to the console sign-in', () => {
    expect(signInUrl('/admin/roles')).toBe('/admin/login?returnUrl=%2Fadmin%2Froles');
  });

  it('sends organisation pages to that organisation’s sign-in', () => {
    expect(signInUrl('/itpo/team?x=1')).toBe('/itpo/login?returnUrl=%2Fitpo%2Fteam%3Fx%3D1');
  });
});
