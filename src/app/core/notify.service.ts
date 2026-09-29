import { Injectable, OnDestroy, signal } from '@angular/core';

/** Options for {@link NotifyService.confirm}. */
export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** Styles the confirm button as destructive (delete, discard). */
  danger?: boolean;
}

export interface Notification {
  kind: 'success' | 'error';
  title: string;
  message?: string;
  viewDetails?: () => void;
  /** How long it stays, ms; drives the countdown bar. */
  duration: number;
}

/** What the app dialog (core/app-dialog.component.ts) shows, if anything. */
export type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (confirmed: boolean) => void }
  | { kind: 'loading'; title: string };

/**
 * Success/error toasts, confirmation dialogs and the blocking loader.
 *
 * Replaces the native `window.alert` / `window.confirm` calls carried over from the
 * React app (decision FD-008 is superseded by FD-013).
 *
 * The store and every screen depend on this service only. Toasts render in
 * `NotificationComponent`, dialogs in `AppDialogComponent`; both are mounted once in the app
 * shell, so every confirmation in the app looks and behaves the same, and specs can replace
 * the whole thing with a plain fake.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService implements OnDestroy {
  readonly notification = signal<Notification | null>(null);
  /** True while the pointer or focus is on the toast; the countdown bar stops with the timer. */
  readonly paused = signal(false);
  readonly dialog = signal<DialogState | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 0;
  private dismissAt = 0;

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
    this.remaining = icon === 'success' ? 4000 : 6000;
    this.paused.set(false);
    this.notification.set({ kind: icon, title, message: text, viewDetails, duration: this.remaining });
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
    this.paused.set(true);
  }

  resume(): void {
    if (!this.notification() || this.timer !== null) return;
    this.paused.set(false);
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
    this.answer(false);
  }

  /** Resolves `true` only when the user explicitly confirms. Escape / backdrop / Cancel = `false`. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    this.dismiss();
    this.answer(false); // a dialog already open counts as cancelled
    return new Promise<boolean>(resolve => this.dialog.set({ kind: 'confirm', options, resolve }));
  }

  /** The user's answer to the open confirmation (called by the dialog component). */
  answer(confirmed: boolean): void {
    const open = this.dialog();
    if (open?.kind !== 'confirm') return;
    this.dialog.set(null);
    open.resolve(confirmed);
  }

  /** Blocking loader for a request in flight. Cannot be dismissed by the user. */
  showLoading(title: string): void {
    this.dismiss();
    this.answer(false);
    this.dialog.set({ kind: 'loading', title });
  }

  /**
   * Closes the loader - and only the loader. If a toast or dialog has already replaced
   * it, that popup is left alone, which makes this safe to call from a `finally` block.
   */
  hideLoading(): void {
    if (this.dialog()?.kind === 'loading') this.dialog.set(null);
  }
}
