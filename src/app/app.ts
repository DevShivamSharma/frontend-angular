import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationComponent } from './core/notification.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificationComponent],
  template: '<router-outlet /><app-notification />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {}
