import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { IconComponent } from '../components/icon.component';
import { hallBadge } from './hall-badge';

/**
 * The hall's name tag pinned to the map ("HALL 14 · GF · Ground floor · 113 available"), so the
 * exhibitor always knows which hall they are looking at, even when zoomed into empty floor.
 */
@Component({
  selector: 'app-hall-badge',
  templateUrl: './hall-badge.component.html',
  styleUrl: './hall-badge.component.css',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.aria-label]': 'label()' }
})
export class HallBadgeComponent {
  readonly hallName = input.required<string>();
  readonly available = input(0);
  readonly total = input(0);

  readonly badge = computed(() => hallBadge(this.hallName()));
  readonly label = computed(() => {
    const b = this.badge();
    const floor = b.floor ? `, ${b.floor.split(' · ')[1]}` : '';
    return `${b.kicker ? 'Hall ' : ''}${b.code}${floor}: ${this.available()} of ${this.total()} stalls available`;
  });
}
