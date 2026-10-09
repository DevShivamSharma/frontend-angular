import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  provideRouter,
  TitleStrategy,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { DialogService } from 'primeng/dynamicdialog';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { API_BASE_URL } from './core/api/api-base.token';
import { errorToastInterceptor } from './core/api/error-toast.interceptor';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { AppPreset } from './core/theme/app-preset';
import { ThemeService } from './core/theme/theme.service';
import { AppTitleStrategy } from './core/ui/app-title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // Pages under /<org>/ read the slug from their own route.
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([errorToastInterceptor, authInterceptor])),
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: AppPreset,
        // Follows the device's light or dark setting, as the app's own tokens do. In a CSS
        // layer, so a component's own styles always win over PrimeNG's without !important.
        options: { darkModeSelector: 'system', cssLayer: { name: 'primeng' } },
      },
      ripple: false,
    }),
    // App-wide toasts (their outlet is in the root component) and dialogs.
    MessageService,
    DialogService,
    // Guards read the session synchronously, so it is restored before the first navigation.
    provideAppInitializer(() => inject(AuthService).restore()),
    // The platform's colours until a route applies an organisation's.
    provideAppInitializer(() => inject(ThemeService).reset()),
  ],
};
