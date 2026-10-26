import { Injectable, signal } from '@angular/core';

/**
 * A page that needs the whole width (the stall planner) asks the shell to show its navigation as
 * icons while it is open. The person's own choice of sidebar width is not touched.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly focus = signal(false);
}
