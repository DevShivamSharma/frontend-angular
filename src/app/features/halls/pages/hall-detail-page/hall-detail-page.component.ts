import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { ApiError } from '../../../../core/http/api-error';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { plainText } from '../../../../shared/utils/text.util';
import { AddImageDialogComponent } from '../../components/add-image-dialog/add-image-dialog.component';
import { HallLayoutPanelComponent } from '../../components/hall-layout-panel/hall-layout-panel.component';
import { HallGalleryComponent } from '../../components/hall-gallery/hall-gallery.component';
import { HallsApiService } from '../../data/halls-api.service';
import { HallImage, ItpoHall } from '../../data/halls.models';
import { ItpoHallsApiService } from '../../data/itpo-halls-api.service';
import { describeHall } from '../../domain/hall-fields';
import { HallImagePayload } from '../../domain/hall-payload';

/** One hall: its pictures (when it has any), what ITPO keeps about it, and a way to add pictures. */
@Component({
  selector: 'app-hall-detail-page',
  imports: [
    DatePipe,
    DecimalPipe,
    ButtonModule,
    SkeletonModule,
    TagModule,
    EmptyStateComponent,
    PageHeaderComponent,
    HallGalleryComponent,
    HallLayoutPanelComponent,
    AddImageDialogComponent,
  ],
  templateUrl: './hall-detail-page.component.html',
  styleUrl: './hall-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallDetailPageComponent implements OnInit {
  /** From the route. */
  readonly hallId = input.required<string>();

  private readonly itpo = inject(ItpoHallsApiService);
  private readonly api = inject(HallsApiService);
  private readonly notifier = inject(NotifierService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required(AddImageDialogComponent);

  protected readonly hall = signal<ItpoHall | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal(false);
  protected readonly addFailure = signal<string | null>(null);

  protected readonly hasCover = computed(() =>
    (this.hall()?.images ?? []).some((image) => image.kind === 'cover'),
  );
  protected readonly description = computed(() => plainText(this.hall()?.description));
  protected readonly allFields = computed(() => {
    const hall = this.hall();
    return hall ? describeHall(hall.raw) : [];
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.itpo
      .hall(Number(this.hallId()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (hall) => {
          this.hall.set(hall);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  protected openAdd(): void {
    this.addFailure.set(null);
    this.dialog().open();
  }

  protected async add(image: HallImagePayload): Promise<void> {
    const hall = this.hall();
    if (!hall) {
      return;
    }
    const go = await this.confirm.ask({
      header: 'Add picture',
      message: 'Add this picture to the hall?',
      acceptLabel: 'Add',
    });
    if (!go) {
      return;
    }
    this.saving.set(true);
    this.addFailure.set(null);
    this.api.addImage(hall.id, image).subscribe({
      next: (saved) => {
        const added: HallImage = {
          documentId: saved.documentId,
          name: lastSegment(saved.url),
          url: saved.url,
          kind: saved.kind,
        };
        this.hall.update((current) =>
          current ? { ...current, images: [...current.images, added] } : current,
        );
        this.saving.set(false);
        this.dialog().visible.set(false);
        this.notifier.success('Picture added');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.addFailure.set(
          error instanceof ApiError ? error.message : 'The picture could not be added.',
        );
      },
    });
  }

  protected async askRemove(image: HallImage): Promise<void> {
    const hall = this.hall();
    if (!hall) {
      return;
    }
    const go = await this.confirm.ask({
      header: 'Remove picture',
      message: 'Take this picture off the hall? The file itself is not deleted.',
      acceptLabel: 'Remove',
      rejectLabel: 'Keep',
      danger: true,
    });
    if (!go) {
      return;
    }
    this.api.removeImage(hall.id, image.documentId).subscribe({
      next: () => {
        this.hall.update((current) =>
          current
            ? {
                ...current,
                images: current.images.filter((i) => i.documentId !== image.documentId),
              }
            : current,
        );
        this.notifier.success('Picture removed');
      },
      error: (error: unknown) => this.notifier.fromError(error, 'The picture could not be removed'),
    });
  }
}

function lastSegment(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
}
