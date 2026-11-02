import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { saveBlob } from '../../../../shared/files/save-blob';
import { PlansApiService } from '../../../planner/data/plans-api.service';
import type { PlanAttachment } from '../../../planner/domain/plan.models';

export interface ReviewNoteDialogData {
  eventId: string;
  eventHallId: string;
  hallName: string;
  note: string | null;
  reviewedAt: string | null;
  attachments: readonly PlanAttachment[];
}

/** Why ITPO sent a plan back: its note, and the pictures it attached as a gallery. */
@Component({
  selector: 'app-review-note-dialog',
  imports: [DatePipe, ButtonModule],
  templateUrl: './review-note-dialog.component.html',
  styleUrl: './review-note-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewNoteDialogComponent {
  protected readonly data = dialogData<ReviewNoteDialogData>();
  protected readonly ref = inject(DialogRef);
  private readonly plans = inject(PlansApiService);
  private readonly notify = inject(NotifierService);

  protected readonly images = this.data.attachments.filter((f) => f.mimeType.startsWith('image/'));
  protected readonly others = this.data.attachments.filter((f) => !f.mimeType.startsWith('image/'));

  /**
   * Where each picture shows from: its S3 link, or for an older file an object URL, as the
   * server's file route needs the sign-in, which an <img> cannot send.
   */
  protected readonly urls = signal<ReadonlyMap<string, string>>(
    new Map(this.images.flatMap((f) => (f.url ? [[f.id, f.url] as const] : []))),
  );
  /** The object URLs made here, freed when the dialog closes. */
  private readonly made: string[] = [];
  protected readonly failed = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedId = signal(this.images[0]?.id ?? null);
  protected readonly selected = computed(
    () => this.images.find((f) => f.id === this.selectedId()) ?? null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const url of this.made) URL.revokeObjectURL(url);
    });
    void this.loadImages();
  }

  private async loadImages(): Promise<void> {
    for (const file of this.images) {
      if (file.url) continue;
      try {
        const blob = await firstValueFrom(this.fetch(file));
        const url = URL.createObjectURL(blob);
        this.made.push(url);
        this.urls.update((map) => new Map(map).set(file.id, url));
      } catch {
        this.failed.update((set) => new Set(set).add(file.id));
      }
    }
  }

  /** Moves through the pictures with the arrows, round from the last to the first. */
  protected step(by: number): void {
    const i = this.images.findIndex((f) => f.id === this.selectedId());
    const next = this.images[(i + by + this.images.length) % this.images.length];
    if (next) this.selectedId.set(next.id);
  }

  protected async download(file: PlanAttachment): Promise<void> {
    // The CDN is another site, where a download link only opens the file; a tab does as well.
    if (file.url) {
      window.open(file.url, '_blank', 'noopener');
      return;
    }
    try {
      saveBlob(await firstValueFrom(this.fetch(file)), file.name);
    } catch (error) {
      this.notify.fromError(error, 'The file could not be downloaded');
    }
  }

  private fetch(file: PlanAttachment) {
    return this.plans.attachment(this.data.eventId, this.data.eventHallId, file.id);
  }
}
