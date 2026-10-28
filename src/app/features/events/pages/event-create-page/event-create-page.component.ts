import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../../core/http/api-error';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { HasUnsavedChanges } from '../../../../shared/guards/unsaved-changes.guard';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { EventWizardDialogComponent } from '../../components/event-wizard-dialog/event-wizard-dialog.component';
import { EventConfigApiService, EventConfigBody } from '../../data/event-config-api.service';
import { EventsApiService } from '../../data/events-api.service';
import { CreateEventPayload, Organisation } from '../../data/events.models';
import { ItpoEventsApiService } from '../../data/itpo-events-api.service';

/** Creates an internal event under an organisation, then opens it to add halls. */
@Component({
  selector: 'app-event-create-page',
  imports: [PageHeaderComponent, EventWizardDialogComponent],
  templateUrl: './event-create-page.component.html',
  styleUrl: './event-create-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCreatePageComponent implements HasUnsavedChanges, AfterViewInit {
  private readonly api = inject(EventsApiService);
  private readonly config = inject(EventConfigApiService);
  private readonly itpo = inject(ItpoEventsApiService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly wizard = viewChild.required(EventWizardDialogComponent);

  protected readonly organisations = signal<Organisation[]>([]);
  protected readonly organisationsLoading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly failure = signal<string | null>(null);

  private saved = false;

  constructor() {
    this.itpo
      .organisations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (organisations) => {
          this.organisations.set(organisations);
          this.organisationsLoading.set(false);
        },
        error: (error: unknown) => {
          this.organisationsLoading.set(false);
          this.notifier.fromError(error, 'The organisations could not be loaded');
        },
      });
  }

  ngAfterViewInit(): void {
    this.wizard().open();
  }

  hasUnsavedChanges(): boolean {
    return !this.saved && this.wizard().hasUnsavedChanges();
  }

  protected async create(payload: CreateEventPayload): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Create event',
      message: `Create the event "${payload.name}"?`,
      acceptLabel: 'Create',
    });
    if (!go) {
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    const hallIds = this.wizard().chosenHallIds();
    const booking = this.wizard().bookingBody();
    this.api.create(payload).subscribe({
      next: (event) => {
        this.saved = true;
        void this.finish(event.id, hallIds, booking);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        if (!(error instanceof ApiError && this.wizard().applyError(error))) {
          this.failure.set(
            error instanceof ApiError ? error.message : 'The event could not be created.',
          );
        }
      },
    });
  }

  /**
   * The wizard's halls and booking setup, sent once the event exists, through the same calls the
   * event page makes. The event stands either way; what could not be saved is said, to finish there.
   */
  private async finish(
    eventId: string,
    hallIds: number[],
    booking: Omit<EventConfigBody, 'eventId'> | null,
  ): Promise<void> {
    const added: string[] = [];
    if (hallIds.length) {
      try {
        await firstValueFrom(this.api.addHalls(eventId, hallIds.map((hallId) => ({ hallId }))));
        added.push(`${hallIds.length} ${hallIds.length === 1 ? 'hall' : 'halls'} added`);
      } catch (error) {
        this.notifier.fromError(
          error,
          'The event was created, but its halls could not be added. Add them from the event.',
        );
      }
    }
    if (booking) {
      try {
        await firstValueFrom(this.config.create({ ...booking, eventId }));
        added.push('booking setup saved');
      } catch (error) {
        this.notifier.fromError(
          error,
          'The event was created, but its booking setup could not be saved. Finish it from the event.',
        );
      }
    }
    this.notifier.success(
      'Event created',
      added.length ? `${added.join(', ')}.` : 'Now add the halls it uses.',
    );
    void this.router.navigate(['/events', eventId]);
  }

  protected cancel(): void {
    void this.router.navigate(['/events']);
  }
}
