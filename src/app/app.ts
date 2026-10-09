import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';

/** The routed app, with the outlet for app-wide toasts. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule],
  template: `
    <router-outlet />
    <p-toast position="bottom-center" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
