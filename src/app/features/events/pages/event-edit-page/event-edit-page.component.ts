import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { HasUnsavedChanges } from '../../../../shared/guards/unsaved-changes.guard';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { EventFormComponent } from '../../components/event-form/event-form.component';
import { EventsApiService } from '../../data/events-api.service';
import { ItpoEventsApiService } from '../../data/itpo-events-api.service';
import { UpdateEventPayload } from '../../data/events.models';
import { KnownEvent } from '../../domain/event.form';

/** Changes an event: only what the user changes is sent. */
@Component({
  selector: 'app-event-edit-page',
  imports: [PageHeaderComponent, EventFormComponent, EmptyStateComponent, ButtonModule],
  templateUrl: './event-edit-page.component.html',
  styleUrl: './event-edit-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventEditPageComponent implements OnInit, HasUnsavedChanges {
  /** From the route. */
  readonly eventId = input.required<string>();

  private readonly api = inject(EventsApiService);
  private readonly itpo = inject(ItpoEventsApiService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(NotifierService);
  private readonly form = viewChild(EventFormComponent);

  protected readonly known = signal<KnownEvent | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly submitting = signal(false);
  protected readonly failure = signal<string | null>(null);

  private saved = false;

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.itpo.event(this.eventId()).subscribe({
      next: (event) => {
        this.known.set(event);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.failed.set(true);
        this.notifier.fromError(error, 'The event could not be loaded');
      },
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.saved && (this.form()?.hasUnsavedChanges() ?? false);
  }

  protected async save(changes: UpdateEventPayload): Promise<void> {
    if (!Object.keys(changes).length) {
      this.notifier.info('Nothing to save', 'You have not changed anything.');
      return;
    }
    const go = await this.confirm.ask({
      header: 'Save changes',
      message: 'Save your changes to this event?',
      acceptLabel: 'Save',
    });
    if (!go) {
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    this.api.update(this.eventId(), changes).subscribe({
      next: () => {
        this.saved = true;
        this.notifier.success('Event saved');
        this.back();
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const form = this.form();
        if (!(error instanceof ApiError && form?.applyError(error))) {
          this.failure.set(
            error instanceof ApiError ? error.message : 'The event could not be saved.',
          );
        }
      },
    });
  }

  protected back(): void {
    void this.router.navigate(['/events', this.eventId()]);
  }
}
