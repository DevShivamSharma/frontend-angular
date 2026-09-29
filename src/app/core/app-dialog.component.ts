import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  viewChild
} from '@angular/core';

import { NotifyService } from './notify.service';

/**
 * The one confirmation dialog (and blocking loader) of the app, mounted once in the app shell
 * and driven by `NotifyService.confirm()` / `showLoading()`. Every screen asks through the
 * service, so every confirmation looks and behaves the same.
 *
 * A native modal <dialog>: focus stays inside while it is open and returns to where it was
 * when it closes. A confirmation starts on Cancel, so a stray Enter never confirms a delete;
 * Escape or a click outside cancels. The loader cannot be dismissed.
 */
@Component({
  selector: 'app-dialog',
  templateUrl: './app-dialog.component.html',
  styleUrl: './app-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppDialogComponent {
  readonly notify = inject(NotifyService);
  private readonly el = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancel');

  constructor() {
    effect(() => {
      const state = this.notify.dialog();
      const dialog = this.el().nativeElement;
      if (state && !dialog.open) dialog.showModal();
      if (!state && dialog.open) dialog.close();
      if (state?.kind === 'confirm') queueMicrotask(() => this.cancelButton()?.nativeElement.focus());
    });
  }

  /** Escape: cancels a confirmation, never closes the loader. */
  onCancel(event: Event): void {
    event.preventDefault();
    this.notify.answer(false);
  }

  /** A click on the backdrop (the dialog element itself, outside its card) cancels. */
  onClick(event: MouseEvent): void {
    if (event.target === this.el().nativeElement) this.notify.answer(false);
  }
}
