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

  error(error: unknown, fallback?: string): void {
    this.messages.add({ severity: 'error', summary: errorMessage(error, fallback), life: 8000 });
  }
}
