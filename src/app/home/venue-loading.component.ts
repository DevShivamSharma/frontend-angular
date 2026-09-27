import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { VenueLoadingState } from './venue-loading.state';
@Component({ selector: 'section[appVenueLoading]', standalone: true, templateUrl: './venue-loading.component.html', changeDetection: ChangeDetectionStrategy.OnPush, host: { id: 'loading', 'aria-labelledby': 'loading-title', '[attr.aria-busy]': '!state.failed() && !state.ready()', '[hidden]': 'state.ready()' } })
export class VenueLoadingComponent {
  @Input({ required: true }) state!: VenueLoadingState;
  @Output() readonly retry = new EventEmitter<void>();
  readonly labels = { loading: 'Loading…', ready: 'Ready', error: 'Try again' };
}
