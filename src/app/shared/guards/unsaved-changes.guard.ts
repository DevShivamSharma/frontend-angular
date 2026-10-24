import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';

import { ConfirmService } from '../../core/confirm/confirm.service';

/** A page that can say whether leaving it would lose what the user typed. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
  /**
   * For a workspace worth a second thought even when nothing is lost (the stall planner): the
   * question to ask when leaving without unsaved changes; null leaves freely.
   */
  confirmLeave?(): { header: string; message: string } | null;
}

/** Asks before leaving a page with unsaved changes; leaving freely when there are none. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  const unsaved = component.hasUnsavedChanges();
  const question = unsaved
    ? {
        header: 'Leave this page?',
        message: 'You have changes that are not saved. If you leave now they will be lost.',
      }
    : (component.confirmLeave?.() ?? null);
  if (!question) {
    return true;
  }
  return inject(ConfirmService).ask({
    ...question,
    acceptLabel: 'Leave',
    rejectLabel: 'Stay',
    danger: unsaved,
    icon: 'pi pi-sign-out',
  });
};
