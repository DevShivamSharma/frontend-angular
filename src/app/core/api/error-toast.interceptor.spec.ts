import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Notifier } from '../ui/notifier.service';
import { API_BASE_URL } from './api-base.token';
import { errorToastInterceptor, quiet } from './error-toast.interceptor';

describe('errorToastInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let notifier: jasmine.SpyObj<Notifier>;

  beforeEach(() => {
    notifier = jasmine.createSpyObj<Notifier>('Notifier', ['error', 'success']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([errorToastInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: Notifier, useValue: notifier },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  /** Makes a call fail with the status, and returns the error the caller received. */
  async function fail(url: string, status: number, options = {}): Promise<unknown> {
    const failed = new Promise((resolve) => http.get(url, options).subscribe({ error: resolve }));
    backend
      .expectOne(url)
      .flush({ status, message: 'There is no such hall.' }, { status, statusText: 'Error' });
    return failed;
  }

  it('shows a failed API call as a toast, and still passes the error on', async () => {
    const error = await fail('/api/orgs/itpo/halls/1', 404);
    expect(notifier.error).toHaveBeenCalledOnceWith(error);
  });

  it('stays quiet for statuses the call handles itself', async () => {
    await fail('/api/orgs/itpo/context', 404, quiet(403, 404));
    await fail('/api/auth/refresh', 401, quiet());
    expect(notifier.error).not.toHaveBeenCalled();
    await fail('/api/orgs/itpo/context', 500, quiet(403, 404));
    expect(notifier.error).toHaveBeenCalledTimes(1);
  });

  it('leaves an ended session to sign-in, but shows wrong sign-in details', async () => {
    await fail('/api/orgs/itpo/members', 401);
    expect(notifier.error).not.toHaveBeenCalled();
    await fail('/api/auth/login', 401);
    expect(notifier.error).toHaveBeenCalledTimes(1);
  });

  it('ignores calls to other sites', async () => {
    await fail('https://fonts.googleapis.com/css2', 500);
    expect(notifier.error).not.toHaveBeenCalled();
  });
});
