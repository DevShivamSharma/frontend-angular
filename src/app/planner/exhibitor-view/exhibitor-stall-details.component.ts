import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { PriceBreakdownComponent } from '../pricing/price-breakdown.component';
import type { PricingSnapshot, StallQuote } from '../pricing/pricing.model';
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
  imports: [IconComponent, PriceBreakdownComponent],
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
  readonly pricing = input<PricingSnapshot | null>(null);
  readonly published = input(false);
  readonly quote = input<StallQuote | null>(null);
  readonly quoteLoading = input(false);
  readonly quoteError = input('');
  readonly stallType = input<'bare' | 'shell'>('bare');
  readonly typeChange = output<'bare' | 'shell'>();
  readonly retry = output<void>();
  changeType(event: Event): void { this.typeChange.emit((event.target as HTMLSelectElement).value as 'bare' | 'shell'); }
  /** A booking request is in flight. */
  readonly booking = input(false);
  /** This stall was just booked from this page: confirm it instead of saying "already booked". */
  readonly bookedHere = input(false);

  readonly book = output<void>();
  readonly close = output<void>();
}
