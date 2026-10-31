import { bootstrapApplication } from '@angular/platform-browser';
import { inject } from '@vercel/analytics';

import { App } from './app/app';
import { appConfig } from './app/app.config';

inject();

bootstrapApplication(App, appConfig).catch((error: unknown) => console.error(error));
