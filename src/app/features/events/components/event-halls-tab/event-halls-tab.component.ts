import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';
import { TagModule } from 'primeng/tag';

import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import {
  HallCategoriesDialogComponent,
  HallCategoriesRequest,
} from '../hall-categories-dialog/hall-categories-dialog.component';
import { ItpoEventsApiService } from '../../data/itpo-events-api.service';
import { ImageFallbackDirective } from '../../../../shared/ui/placeholder-image/image-fallback.directive';
import { PLACEHOLDER_IMAGE } from '../../../../shared/ui/placeholder-image/placeholder-image';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { ItpoEventHall } from '../../data/events.models';
import { EventDetailStore } from '../../state/event-detail.store';
import { AddHallsDialogComponent } from '../add-halls-dialog/add-halls-dialog.component';

/** The halls of an event: add and remove. */
@Component({
  selector: 'app-event-halls-tab',
  imports: [
    RouterLink,
    MenuModule,
    ButtonModule,
    TagModule,
    EmptyStateComponent,
    ImageFallbackDirective,
    AddHallsDialogComponent,
    HallCategoriesDialogComponent,
  ],
  templateUrl: './event-halls-tab.component.html',
  styleUrl: './event-halls-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventHallsTabComponent {
  readonly store = input.required<EventDetailStore>();
  /** The event is for reading: no adding or removing. */
  readonly readonly = input(false);

  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifierService);
  private readonly api = inject(ItpoEventsApiService);
  private readonly auth = inject(AuthService);
  private readonly addDialog = viewChild.required(AddHallsDialogComponent);
  private readonly categoriesDialog = viewChild.required(HallCategoriesDialogComponent);

  protected readonly placeholder = PLACEHOLDER_IMAGE;
  protected readonly saving = signal(false);
  /** The hall whose menu is open. */
  protected readonly menuHall = signal<ItpoEventHall | null>(null);
  protected readonly menuItems = computed<MenuItem[]>(() => {
    const hall = this.menuHall();
    return hall
      ? [
          {
            label: 'Category management',
            icon: 'pi pi-tags',
            command: () => this.openCategories(hall),
          },
        ]
      : [];
  });

  /**
   * Where the stall planner of a hall is, or null when this user has none: ITPO staff plan the
   * halls of internal events; an external event is planned once it is approved, by its organiser
   * (ITPO staff open it to review).
   */
  protected readonly plannerBase = computed(() => {
    const event = this.store().summary();
    if (!event) return null;
    if (event.kind === 'internal') return this.store().canManage() ? '/events' : null;
    return event.approvalStatus === 'Approved' ? '/external-events' : null;
  });
  protected readonly plannerLabel = computed(() =>
    this.store().summary()?.kind === 'external' && this.auth.isStaff()
      ? 'Review plan'
      : 'Plan stalls',
  );
  protected readonly takenIds = computed(() =>
    this.store()
      .halls()
      .map((hall) => hall.hallId),
  );

  protected openCategories(hall: ItpoEventHall): void {
    this.categoriesDialog().open({ id: hall.eventHallId, name: hall.name });
  }

  protected async saveCategories(request: HallCategoriesRequest): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Save categories',
      message: `Save the categories ${request.hallName} sells (${request.categoryIds.length} chosen)?`,
      acceptLabel: 'Save',
    });
    if (!go) {
      return;
    }
    this.saving.set(true);
    this.api.setHallCategories(request.eventHallId, request.categoryIds).subscribe({
      next: () => {
        this.saving.set(false);
        this.categoriesDialog().visible.set(false);
        this.notify.success('Categories saved', request.hallName);
      },
      error: (error) => {
        this.saving.set(false);
        this.notify.fromError(error);
      },
    });
  }

  protected openAdd(): void {
    this.addDialog().open();
  }

  protected async add(halls: Parameters<EventDetailStore['addHalls']>[0]): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Add to the event',
      message:
        halls.length === 1
          ? 'Add this hall to the event?'
          : `Add these ${halls.length} halls to the event?`,
      acceptLabel: 'Add',
    });
    if (!go) {
      return;
    }
    this.saving.set(true);
    this.store()
      .addHalls(halls)
      .subscribe({
        next: (added) => {
          this.saving.set(false);
          this.addDialog().visible.set(false);
          this.notify.success(
            added.halls.length === 1 ? 'Hall added' : `${added.halls.length} halls added`,
          );
        },
        error: (error) => {
          this.saving.set(false);
          this.notify.fromError(error);
        },
      });
  }

  protected async askRemove(hall: ItpoEventHall): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Remove hall',
      message: `Remove ${hall.name} from this event?`,
      acceptLabel: 'Remove',
      rejectLabel: 'Keep',
      danger: true,
    });
    if (!go) {
      return;
    }
    this.store()
      .removeHall(hall.eventHallId)
      .subscribe({
        next: () => this.notify.success(`${hall.name} removed`),
        error: (error) => this.notify.fromError(error),
      });
  }
}
