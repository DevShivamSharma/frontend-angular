import { inject, Injectable } from '@angular/core';
import { MessageService } from 'primeng/api';

import { errorMessage } from '../api/http-error';

/** Short confirmations and failures, as a toast. */
@Injectable({ providedIn: 'root' })
export class Notifier {
  private readonly messages = inject(MessageService);

  success(message: string): void {
    this.messages.add({ severity: 'success', summary: message, life: 4000 });
  }

  /** Something refused, with why: a rule a change would break. */
  warn(message: string): void {
    this.messages.add({ severity: 'warn', summary: message, life: 8000 });
  }

  error(error: unknown, fallback?: string): void {
    this.messages.add({ severity: 'error', summary: errorMessage(error, fallback), life: 8000 });
  }
}
