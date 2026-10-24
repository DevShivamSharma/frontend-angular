import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
} from '@angular/router';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { BrowserTokenStorage, TokenStorage } from './core/auth/token-storage';
import { envelopeInterceptor } from './core/http/envelope.interceptor';
import { AppPreset } from './core/theme/app-preset';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withPreloading(PreloadAllModules),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    // The auth interceptor is outermost: it sees the envelope interceptor's ApiError (a 401) and can refresh.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, envelopeInterceptor])),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: AppPreset,
        // Dark when the page says so (ThemeService), in a CSS layer so a component's own styles win.
        options: { darkModeSelector: '[data-theme="dark"]', cssLayer: { name: 'primeng' } },
      },
      ripple: false,
    }),
    MessageService,
    DialogService,
    { provide: TokenStorage, useClass: BrowserTokenStorage },
    // The saved session is picked up before the first navigation, so the guards can read it.
    provideAppInitializer(() => inject(AuthService).restore()),
  ],
};
