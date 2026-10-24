import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { MultiSelectModule } from 'primeng/multiselect';
import { forkJoin } from 'rxjs';

import { EventCategory } from '../../data/events.models';
import { ItpoEventsApiService } from '../../data/itpo-events-api.service';

export interface HallCategoriesRequest {
  eventHallId: string;
  hallName: string;
  categoryIds: number[];
}

/** Chooses the categories one hall of an internal event sells, from those of the event's product category. */
@Component({
  selector: 'app-hall-categories-dialog',
  imports: [ReactiveFormsModule, DialogModule, ButtonModule, MultiSelectModule],
  templateUrl: './hall-categories-dialog.component.html',
  styleUrl: './hall-categories-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallCategoriesDialogComponent {
  readonly visible = model(false);
  readonly eventId = input.required<string>();
  readonly saving = input.required<boolean>();
  readonly saved = output<HallCategoriesRequest>();

  private readonly api = inject(ItpoEventsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hall = signal<{ id: string; name: string } | null>(null);
  protected readonly options = signal<EventCategory[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly picker = new FormControl<number[]>([], { nonNullable: true });
  protected readonly chosen = signal<number[]>([]);
  private readonly before = signal<number[]>([]);

  protected readonly unchanged = computed(() => {
    const now = [...this.chosen()].sort((a, b) => a - b).join(',');
    return now === [...this.before()].sort((a, b) => a - b).join(',');
  });

  open(hall: { id: string; name: string }): void {
    this.hall.set(hall);
    this.visible.set(true);
    this.loading.set(true);
    this.failed.set(false);
    this.options.set([]);
    this.picker.setValue([]);
    this.chosen.set([]);
    this.before.set([]);
    forkJoin({
      event: this.api.eventCategories(this.eventId()),
      own: this.api.hallCategories(hall.id),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ event, own }) => {
          // A category the hall already sells stays on the list, even if the event no longer offers it.
          const known = new Set(event.map((c) => c.id));
          this.options.set([...event, ...own.filter((c) => !known.has(c.id))]);
          const ids = own.map((c) => c.id);
          this.picker.setValue(ids);
          this.chosen.set(ids);
          this.before.set(ids);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected choose(ids: number[]): void {
    this.chosen.set(ids);
  }

  protected save(): void {
    const hall = this.hall();
    if (hall) {
      this.saved.emit({ eventHallId: hall.id, hallName: hall.name, categoryIds: this.chosen() });
    }
  }
}
