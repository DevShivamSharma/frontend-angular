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
import { Router, RouterLink } from '@angular/router';
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
import { HallDetailsFormComponent } from '../../components/hall-details-form/hall-details-form.component';
import { HallLayoutPanelComponent } from '../../components/hall-layout-panel/hall-layout-panel.component';
import { HallGalleryComponent } from '../../components/hall-gallery/hall-gallery.component';
import { HallsApiService } from '../../data/halls-api.service';
import { HallCategory, HallImage, ItpoHall } from '../../data/halls.models';
import { ItpoHallsApiService } from '../../data/itpo-halls-api.service';
import { describeHall } from '../../domain/hall-fields';
import { HallImagePayload } from '../../domain/hall-payload';

type HallSection = 'details' | 'photos' | 'floor' | 'admin';
const SECTIONS: readonly HallSection[] = ['details', 'photos', 'floor', 'admin'];

/** One hall, a section at a time: its details, its pictures, its floor plan and ITPO's own fields. */
@Component({
  selector: 'app-hall-detail-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    ButtonModule,
    SkeletonModule,
    TagModule,
    EmptyStateComponent,
    PageHeaderComponent,
    HallGalleryComponent,
    HallLayoutPanelComponent,
    AddImageDialogComponent,
    HallDetailsFormComponent,
  ],
  templateUrl: './hall-detail-page.component.html',
  styleUrl: './hall-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallDetailPageComponent implements OnInit {
  /** From the route. */
  readonly hallId = input.required<string>();
  /** The section shown, from the address so a reload or a shared link opens the same one. */
  readonly section = input<HallSection, string | undefined>('details', {
    // The router sets an input to undefined when its query parameter is not in the address.
    transform: (value) =>
      SECTIONS.includes(value as HallSection) ? (value as HallSection) : 'details',
  });

  private readonly itpo = inject(ItpoHallsApiService);
  private readonly api = inject(HallsApiService);
  private readonly notifier = inject(NotifierService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required(AddImageDialogComponent);

  protected readonly hall = signal<ItpoHall | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal(false);
  protected readonly addFailure = signal<string | null>(null);

  // Editing the details in place.
  protected readonly editing = signal(false);
  protected readonly categories = signal<HallCategory[]>([]);
  protected readonly savingDetails = signal(false);
  protected readonly detailsFailure = signal<string | null>(null);

  /** The rail: each section with the line under its title, and the one shown. */
  protected readonly sections = computed(() => {
    const hall = this.hall();
    const photos = hall?.images.length ?? 0;
    return [
      {
        id: 'details' as const,
        title: 'Details',
        note: hall?.hallCategory?.name ?? 'No category',
        gist: 'What the hall offers and who looks after it.',
      },
      {
        id: 'photos' as const,
        title: 'Photos',
        note: photos ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : 'None yet',
        gist: 'Exhibitors see these photos on SelfCare when they book.',
      },
      {
        id: 'floor' as const,
        title: 'Floor plan',
        note: 'Grid, pillars and walls',
        gist: 'The layout the stall planner draws on.',
      },
      {
        id: 'admin' as const,
        title: 'Admin details',
        note: 'For support',
        gist: 'System fields, for support.',
      },
    ];
  });
  protected readonly current = computed(
    () => this.sections().find((s) => s.id === this.section()) ?? this.sections()[0],
  );

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

  protected select(section: HallSection): void {
    this.editing.set(false);
    void this.router.navigate([], {
      queryParams: { section: section === 'details' ? null : section },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected startEdit(): void {
    this.detailsFailure.set(null);
    this.editing.set(true);
    if (!this.categories().length) {
      this.itpo
        .categories()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (categories) => this.categories.set(categories),
          // Without them the category list is empty; the rest can still be changed.
          error: () => this.categories.set([]),
        });
    }
  }

  protected async saveDetails(changes: Record<string, unknown>): Promise<void> {
    const hall = this.hall();
    if (!hall) {
      return;
    }
    const go = await this.confirm.ask({
      header: 'Save details',
      message: `Save the changes to ${hall.name}? They are saved with ITPO's halls.`,
      acceptLabel: 'Save',
    });
    if (!go) {
      return;
    }
    this.savingDetails.set(true);
    this.detailsFailure.set(null);
    this.api.update(hall.id, changes).subscribe({
      next: () => {
        // ITPO's own copy is the truth: read the hall again rather than guess what it stored.
        this.itpo
          .hall(hall.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (fresh) => this.hall.set(fresh),
            error: () =>
              this.notifier.warn('Saved, but the hall could not be read again. Reload the page.'),
          });
        this.savingDetails.set(false);
        this.editing.set(false);
        this.notifier.success('Details saved');
      },
      error: (error: unknown) => {
        this.savingDetails.set(false);
        this.detailsFailure.set(
          error instanceof ApiError ? error.message : 'The details could not be saved.',
        );
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
