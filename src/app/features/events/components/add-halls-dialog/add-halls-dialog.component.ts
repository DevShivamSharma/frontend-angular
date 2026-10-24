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

import { ItpoHall } from '../../../halls/data/halls.models';
import { ItpoHallsApiService } from '../../../halls/data/itpo-halls-api.service';
import { AddHallPayload } from '../../data/events.models';

/** Picks the halls ITPO has that the event does not, and adds them. */
@Component({
  selector: 'app-add-halls-dialog',
  imports: [ReactiveFormsModule, DialogModule, ButtonModule, MultiSelectModule],
  templateUrl: './add-halls-dialog.component.html',
  styleUrl: './add-halls-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddHallsDialogComponent {
  readonly visible = model(false);
  readonly saving = input.required<boolean>();
  /** Halls the event already has; they cannot be added twice. */
  readonly taken = input<readonly number[]>([]);
  readonly added = output<AddHallPayload[]>();

  private readonly api = inject(ItpoHallsApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly all = signal<ItpoHall[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly options = computed(() =>
    this.all().filter((hall) => hall.isActive && !this.taken().includes(hall.id)),
  );
  protected readonly chosen = signal<number[]>([]);
  protected readonly picker = new FormControl<number[]>([], { nonNullable: true });

  open(): void {
    this.picker.setValue([]);
    this.chosen.set([]);
    this.visible.set(true);
    if (!this.all().length) {
      this.load();
    }
  }

  protected choose(ids: number[]): void {
    this.chosen.set(ids);
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .halls({ page: 1, size: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.all.set(page.items);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected add(): void {
    const ids = this.chosen();
    if (ids.length) {
      this.added.emit(ids.map((hallId) => ({ hallId })));
    }
  }
}
