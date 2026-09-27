import { Injectable, OnDestroy, signal } from '@angular/core';
import Swal, { SweetAlertOptions } from 'sweetalert2';

/** Options for {@link NotifyService.confirm}. */
export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  /** Styles the confirm button as destructive (delete, discard). */
  danger?: boolean;
}

export interface Notification {
  kind: 'success' | 'error';
  title: string;
  message?: string;
  viewDetails?: () => void;
}

/**
 * Success/error toasts, confirmation dialogs and the blocking loader.
 *
 * Replaces the native `window.alert` / `window.confirm` calls carried over from the
 * React app (decision FD-008 is superseded by FD-013).
 *
 * This is the ONLY file that imports SweetAlert2. The store and components depend on
 * this service, so the library can be swapped without touching them - and specs can
 * replace the whole thing with a plain fake.
 *
 * Toasts use the app's compact notification component. SweetAlert2 is only used for
 * confirmation dialogs and blocking loaders.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService implements OnDestroy {
  readonly notification = signal<Notification | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 0;
  private dismissAt = 0;
  /** Colours come from the design tokens in `styles.css`, so the popups match the app. */
  private readonly base: SweetAlertOptions = {
    theme: 'light',
    background: 'var(--surface-card)',
    color: 'var(--text-primary)'
  };

  /** Non-blocking toast, top right, auto-dismissed. */
  success(title: string, text?: string): void {
    this.toast('success', text ? title : 'Success', text ?? title);
  }

  /** Uses the same notification surface as saves, updates and deletes. */
  error(title: string, text?: string, viewDetails?: () => void): void {
    this.toast('error', title, text, viewDetails);
  }

  private toast(icon: 'success' | 'error', title: string, text?: string, viewDetails?: () => void): void {
    this.dismiss();
    this.hideLoading();
    this.notification.set({ kind: icon, title, message: text, viewDetails });
    this.remaining = icon === 'success' ? 4000 : 6000;
    this.resume();
  }

  dismiss(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.notification.set(null);
  }

  pause(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.remaining = Math.max(0, this.dismissAt - Date.now());
  }

  resume(): void {
    if (!this.notification() || this.timer !== null) return;
    this.dismissAt = Date.now() + this.remaining;
    this.timer = setTimeout(() => this.dismiss(), this.remaining);
  }

  viewDetails(): void {
    const action = this.notification()?.viewDetails;
    this.dismiss();
    action?.();
  }

  ngOnDestroy(): void {
    this.dismiss();
  }

  /** Resolves `true` only when the user explicitly confirms. Escape / backdrop = `false`. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    this.dismiss();
    const result = await Swal.fire({
      ...this.base,
      icon: options.danger ? 'warning' : 'question',
      title: options.title,
      text: options.text,
      showCancelButton: true,
      focusCancel: true,
      reverseButtons: true,
      confirmButtonText: options.confirmText ?? 'Confirm',
      confirmButtonColor: options.danger ? 'var(--danger-solid)' : 'var(--accent-solid)',
      cancelButtonColor: 'var(--text-secondary)'
    });

    return result.isConfirmed;
  }

  /** Blocking loader for a request in flight. Cannot be dismissed by the user. */
  showLoading(title: string): void {
    this.dismiss();
    void Swal.fire({
      ...this.base,
      title,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading()
    });
  }

  /**
   * Closes the loader - and only the loader. If a toast or dialog has already replaced
   * it, that popup is left alone, which makes this safe to call from a `finally` block.
   */
  hideLoading(): void {
    if (Swal.isLoading()) {
      Swal.close();
    }
  }
}
