import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../planner/components/icon.component';
import { NotifyService } from './notify.service';

@Component({
  selector: 'app-notification',
  imports: [IconComponent],
  templateUrl: './notification.component.html',
  styleUrl: './notification.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationComponent {
  readonly notify = inject(NotifyService);

  resume(event: MouseEvent | FocusEvent): void {
    const card = event.currentTarget as HTMLElement;
    if (!card.matches(':hover') && !card.contains(document.activeElement)) this.notify.resume();
  }
}
