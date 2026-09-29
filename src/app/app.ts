import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationComponent } from './core/notification.component';
import { AppDialogComponent } from './core/app-dialog.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificationComponent, AppDialogComponent],
  template: '<router-outlet /><app-notification /><app-dialog />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {}
