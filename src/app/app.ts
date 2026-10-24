import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';

import { ThemeService } from './core/theme/theme.service';

/** The routed app, with the outlets for the toasts every page shares. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  // Created at start so the saved theme is on the page whichever screen opens first.
  constructor() {
    inject(ThemeService);
  }
}
