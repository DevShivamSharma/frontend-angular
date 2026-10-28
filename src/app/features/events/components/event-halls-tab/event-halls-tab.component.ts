import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';

import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import {
  HallCategoriesDialogComponent,
  HallCategoriesRequest,
} from '../hall-categories-dialog/hall-categories-dialog.component';
import { PlansApiService } from '../../../planner/data/plans-api.service';
import type {
  HallPlanStatus,
  PlanAttachment,
  PlanStatus,
} from '../../../planner/domain/plan.models';
import {
  RejectDialogComponent,
  RejectDialogData,
  RejectDialogResult,
} from '../../../planner/components/reject-dialog/reject-dialog.component';
import { saveBlob } from '../../../../shared/files/save-blob';
import { AppDialog } from '../../../../core/dialog/app-dialog.service';
import {
  HallConfigData,
  HallConfigDialogComponent,
} from '../hall-config-dialog/hall-config-dialog.component';
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
  private readonly dialogs = inject(AppDialog);
  private readonly plans = inject(PlansApiService);

  /** Where each hall's plan stands, by the hall's id in the event. */
  protected readonly statuses = signal<ReadonlyMap<string, HallPlanStatus>>(new Map());
  protected readonly working = signal<string | null>(null);
  /** "2 of 3 halls approved", for an external event. */
  protected readonly approvedSummary = computed(() => {
    if (this.store().summary()?.kind !== 'external') return null;
    const all = [...this.statuses().values()];
    if (!all.length) return null;
    return `${all.filter((s) => s.status === 'approved').length} of ${all.length} halls approved`;
  });

  constructor() {
    effect(() => {
      const id = this.store().summary()?.id;
      this.store().halls();
      if (id) untracked(() => void this.loadStatuses(id));
    });
  }

  protected statusOf(hall: ItpoEventHall): HallPlanStatus | null {
    return this.statuses().get(hall.eventHallId) ?? null;
  }

  protected statusLabel(status: PlanStatus): string {
    return STATUS_LABEL[status];
  }

  protected statusSeverity(
    status: PlanStatus,
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    return STATUS_SEVERITY[status];
  }

  private async loadStatuses(eventId: string): Promise<void> {
    try {
      const list = await firstValueFrom(this.plans.planStatuses(eventId));
      this.statuses.set(new Map(list.map((s) => [s.eventHallId, s] as const)));
    } catch {
      // The statuses are an extra: the halls still show.
    }
  }

  /** Runs one step of the approval, after asking, then reads the statuses again. */
  private async step(
    hall: ItpoEventHall,
    ask: { header: string; message: string; acceptLabel: string; danger?: boolean } | null,
    run: () => Promise<unknown>,
    done: string,
  ): Promise<void> {
    const eventId = this.store().summary()?.id;
    if (!eventId) return;
    if (ask && !(await this.confirm.ask(ask))) return;
    this.working.set(hall.eventHallId);
    try {
      await run();
      this.notify.success(done, hall.name);
      await this.loadStatuses(eventId);
    } catch (error) {
      this.notify.fromError(error, 'The step could not be done');
    } finally {
      this.working.set(null);
    }
  }

  protected send(hall: ItpoEventHall, s: HallPlanStatus): Promise<void> {
    const eventId = this.store().summary()!.id;
    return this.step(
      hall,
      {
        header: 'Send for approval',
        message: `Send ${hall.name} to ITPO for approval? It cannot change while it waits, unless you withdraw it.`,
        acceptLabel: 'Send',
      },
      () => firstValueFrom(this.plans.submit(eventId, hall.eventHallId, s.revision)),
      'Sent to ITPO for approval',
    );
  }

  protected withdraw(hall: ItpoEventHall): Promise<void> {
    const eventId = this.store().summary()!.id;
    return this.step(
      hall,
      {
        header: 'Withdraw from approval',
        message: `Take ${hall.name} back? It returns to Draft and can be changed again.`,
        acceptLabel: 'Withdraw',
      },
      () => firstValueFrom(this.plans.withdraw(eventId, hall.eventHallId)),
      'Taken back to Draft',
    );
  }

  protected approve(hall: ItpoEventHall, s: HallPlanStatus): Promise<void> {
    const eventId = this.store().summary()!.id;
    return this.step(
      hall,
      {
        header: 'Approve the plan',
        message: `Approve the plan of ${hall.name}? The organiser is told and can publish it.`,
        acceptLabel: 'Approve',
      },
      () =>
        firstValueFrom(
          this.plans.approve(eventId, hall.eventHallId, s.review?.revision ?? s.revision),
        ),
      'Plan approved',
    );
  }

  protected async reject(hall: ItpoEventHall, s: HallPlanStatus): Promise<void> {
    const eventId = this.store().summary()!.id;
    const sent = await firstValueFrom(
      this.dialogs.open<RejectDialogResult>(RejectDialogComponent, {
        data: { hallName: hall.name } satisfies RejectDialogData,
        width: 'min(560px, 96vw)',
      }),
      { defaultValue: undefined },
    );
    if (!sent) return;
    await this.step(
      hall,
      null,
      () =>
        firstValueFrom(
          this.plans.reject(
            eventId,
            hall.eventHallId,
            s.review?.revision ?? s.revision,
            sent.note,
            sent.files,
          ),
        ),
      'Sent back to the organiser',
    );
  }

  protected reopen(hall: ItpoEventHall): Promise<void> {
    const eventId = this.store().summary()!.id;
    return this.step(
      hall,
      {
        header: 'Reopen the plan',
        message: `Take ${hall.name} back to Draft? The organiser is told, can change the plan and must send it again.`,
        acceptLabel: 'Reopen',
      },
      () => firstValueFrom(this.plans.reopen(eventId, hall.eventHallId)),
      'Reopened as Draft',
    );
  }

  protected async download(hall: ItpoEventHall, file: PlanAttachment): Promise<void> {
    const eventId = this.store().summary()?.id;
    if (!eventId) return;
    try {
      saveBlob(
        await firstValueFrom(this.plans.attachment(eventId, hall.eventHallId, file.id)),
        file.name,
      );
    } catch (error) {
      this.notify.fromError(error, 'The file could not be downloaded');
    }
  }
  private readonly addDialog = viewChild.required(AddHallsDialogComponent);
  private readonly categoriesDialog = viewChild.required(HallCategoriesDialogComponent);

  protected readonly placeholder = PLACEHOLDER_IMAGE;
  protected readonly saving = signal(false);
  /** The hall whose menu is open. */
  protected readonly menuHall = signal<ItpoEventHall | null>(null);
  protected readonly menuItems = computed<MenuItem[]>(() => {
    const hall = this.menuHall();
    if (!hall) return [];
    const items: MenuItem[] = [
      {
        label: 'Category management',
        icon: 'pi pi-tags',
        command: () => this.openCategories(hall),
      },
    ];
    // ITPO sets the stall booking windows and limits of its own events (SelfCare's Add/Edit Config).
    if (this.store().summary()?.kind === 'internal' && this.store().canManage()) {
      items.push({
        label: 'Add / edit configuration',
        icon: 'pi pi-cog',
        command: () => this.openConfig(hall),
      });
    }
    items.push({ separator: true });
    items.push({
      label: 'Remove from event',
      icon: 'pi pi-trash',
      styleClass: 'menu-item--danger',
      command: () => this.askRemove(hall),
    });
    return items;
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

  protected openConfig(hall: ItpoEventHall): void {
    const eventId = this.store().summary()?.id;
    if (!eventId) return;
    this.dialogs
      .open(HallConfigDialogComponent, {
        data: {
          eventId,
          eventHallId: hall.eventHallId,
          hallName: hall.name,
          isFnb: hall.forStallFnb || hall.forHorseShoe,
        } satisfies HallConfigData,
        width: 'min(720px, 96vw)',
      })
      .subscribe();
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

const STATUS_LABEL: Record<PlanStatus, string> = {
  not_started: 'Not started',
  draft: 'Draft',
  planned: 'Planned',
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_SEVERITY: Record<PlanStatus, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
  not_started: 'secondary',
  draft: 'info',
  planned: 'success',
  pending: 'warn',
  approved: 'success',
  rejected: 'danger',
};
