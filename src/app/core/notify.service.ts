import { Injectable } from '@angular/core';
import Swal, { SweetAlertOptions } from 'sweetalert2';

/** Options for {@link NotifyService.confirm}. */
export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  /** Styles the confirm button as destructive (delete, discard). */
  danger?: boolean;
}

/**
 * Success messages, confirmation dialogs and the blocking loader.
 *
 * Replaces the native `window.alert` / `window.confirm` calls carried over from the
 * React app (decision FD-008 is superseded by FD-013).
 *
 * This is the ONLY file that imports SweetAlert2. The store and components depend on
 * this service, so the library can be swapped without touching them - and specs can
 * replace the whole thing with a plain fake.
 *
 * SweetAlert2 shows one popup at a time. That is used deliberately: firing a success
 * toast replaces an open loader, so callers never have to order the two.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  /** Colours come from the design tokens in `styles.css`, so the popups match the app. */
  private readonly base: SweetAlertOptions = {
    theme: 'dark',
    background: 'var(--surface-card)',
    color: 'var(--text-primary)'
  };

  /** Non-blocking toast, top right, auto-dismissed. */
  success(title: string, text?: string): void {
    void Swal.fire({
      ...this.base,
      toast: true,
      position: 'top-end',
      icon: 'success',
      title,
      text,
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true
    });
  }

  /** Resolves `true` only when the user explicitly confirms. Escape / backdrop = `false`. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
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
      cancelButtonColor: 'var(--border-strong)'
    });

    return result.isConfirmed;
  }

  /** Blocking loader for a request in flight. Cannot be dismissed by the user. */
  showLoading(title: string): void {
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
