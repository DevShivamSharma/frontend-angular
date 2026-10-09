import { inject, Injectable, Type } from '@angular/core';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, take } from 'rxjs';

export interface AppDialogOptions<D> {
  data?: D;
  /** CSS width; dialogs stay within the screen on phones. */
  width?: string;
  /** False: only the dialog's own buttons close it (no Escape, no click outside). */
  dismissable?: boolean;
}

/**
 * Opens a component as a modal dialog. The component draws its own title, content and
 * actions (`.dialog-title`, `.dialog-content`, `.dialog-actions`), reads its data with
 * `dialogData()`, and closes through {@link DynamicDialogRef}; the caller gets the result,
 * or undefined when dismissed.
 */
@Injectable({ providedIn: 'root' })
export class AppDialog {
  private readonly dialogs = inject(DialogService);

  open<R = unknown, D = unknown>(
    component: Type<unknown>,
    options: AppDialogOptions<D> = {},
  ): Observable<R | undefined> {
    const ref = this.openRef(component, options);
    return ref ? (ref.onClose.pipe(take(1)) as Observable<R | undefined>) : of(undefined);
  }

  /** As {@link open}, for a caller that also closes the dialog itself. */
  openRef<D = unknown>(
    component: Type<unknown>,
    options: AppDialogOptions<D> = {},
  ): DynamicDialogRef | null {
    const dismissable = options.dismissable ?? true;
    return this.dialogs.open(component, {
      data: options.data,
      modal: true,
      showHeader: false,
      closeOnEscape: dismissable,
      dismissableMask: dismissable,
      focusOnShow: true,
      // A dialog may open over another of its kind (a tour inside an import, a confirm in a
      // confirm); without this PrimeNG silently opens nothing.
      duplicate: true,
      style: { width: options.width ?? 'min(560px, 94vw)', maxHeight: '94dvh' },
      contentStyle: { padding: '0' },
    });
  }
}

/** The data a dialog was opened with. Call in a field initialiser of the dialog component. */
export function dialogData<D>(): D {
  return inject(DynamicDialogConfig).data as D;
}

export { DynamicDialogRef as DialogRef };
