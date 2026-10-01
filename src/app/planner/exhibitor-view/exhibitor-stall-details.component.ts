import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { IconComponent } from '../components/icon.component';
import type { ExhibitorStall } from './exhibitor-view';

/**
 * The chosen stall: status, size, area, open sides and the one next step — booking it when it
 * is available. A side panel card on wide screens, a bottom sheet on phones.
 */
@Component({
  selector: 'app-exhibitor-stall-details',
  templateUrl: './exhibitor-stall-details.component.html',
  styleUrl: './exhibitor-stall-details.component.css',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'region',
    'aria-live': 'polite',
    '[attr.aria-label]': '"Stall " + stall().name',
    '[class.is-booked]': '!stall().available'
  }
})
export class ExhibitorStallDetailsComponent {
  readonly stall = input.required<ExhibitorStall>();
  /** A booking request is in flight. */
  readonly booking = input(false);
  /** This stall was just booked from this page: confirm it instead of saying "already booked". */
  readonly bookedHere = input(false);

  readonly book = output<void>();
  readonly close = output<void>();
}
