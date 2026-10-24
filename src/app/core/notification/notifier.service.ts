import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

import { ApiError } from '../http/api-error';

/** The one place a toast is raised from, so every message looks and lasts the same. */
@Injectable({ providedIn: 'root' })
export class NotifierService {
  private readonly messages = inject(MessageService);

  success(summary: string, detail?: string): void {
    this.messages.add({ severity: 'success', summary, detail, life: 4000 });
  }

  info(summary: string, detail?: string): void {
    this.messages.add({ severity: 'info', summary, detail, life: 4000 });
  }

  /** Takes every toast away, e.g. when the page they were about is left. */
  clear(): void {
    this.messages.clear();
  }

  /** Something was not done, and why: it needs reading, but is not a failure. */
  warn(summary: string, detail?: string): void {
    this.messages.add({ severity: 'warn', summary, detail, life: 8000 });
  }

  /** An error stays longer: the user may need to read it twice. */
  error(summary: string, detail?: string): void {
    this.messages.add({ severity: 'error', summary, detail, life: 8000 });
  }

  /** What went wrong with an API call, in the words the API used. */
  fromError(error: unknown, summary = 'Something went wrong'): void {
    this.error(summary, error instanceof ApiError ? error.message : undefined);
  }
}
