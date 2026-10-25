import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';

import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';

export interface RejectDialogData {
  hallName: string;
}

/** What the reviewer sends back: what must change, and optional proof. */
export interface RejectDialogResult {
  note: string;
  files: File[];
}

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED = /\.(jpe?g|png|webp|pdf)$/i;

/**
 * Sending a hall's plan back: a remark that says what must change (needed), and images or PDFs
 * as proof (optional, up to 5 of 5 MB each).
 */
@Component({
  selector: 'app-reject-dialog',
  imports: [DecimalPipe, ReactiveFormsModule, ButtonModule, TextareaModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reject-dialog.component.html',
  styleUrl: './reject-dialog.component.scss',
})
export class RejectDialogComponent {
  protected readonly data = dialogData<RejectDialogData>();
  protected readonly ref = inject(DialogRef);
  protected readonly maxFiles = MAX_FILES;
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3), Validators.maxLength(1000)],
  });
  protected readonly files = signal<File[]>([]);
  protected readonly problem = signal('');
  protected readonly dragging = signal(false);
  protected readonly totalSize = computed(() => this.files().reduce((n, f) => n + f.size, 0));

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add([...(input.files ?? [])]);
    input.value = '';
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.add([...(event.dataTransfer?.files ?? [])]);
  }

  protected over(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected remove(index: number): void {
    this.files.update((list) => list.filter((_, i) => i !== index));
    this.problem.set('');
  }

  protected send(): void {
    if (this.note.invalid) {
      this.note.markAsTouched();
      return;
    }
    this.ref.close({
      note: this.note.value.trim(),
      files: this.files(),
    } satisfies RejectDialogResult);
  }

  private add(incoming: File[]): void {
    const problems: string[] = [];
    const next = [...this.files()];
    for (const file of incoming) {
      if (!ALLOWED.test(file.name))
        problems.push(`${file.name}: only images (JPG, PNG, WebP) and PDF.`);
      else if (file.size > MAX_FILE_BYTES) problems.push(`${file.name}: over 5 MB.`);
      else if (next.length >= MAX_FILES) problems.push(`At most ${MAX_FILES} files.`);
      else if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
    }
    this.files.set(next);
    this.problem.set([...new Set(problems)].join(' '));
  }
}
