import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';

/** Carries the selected file across an Angular route without uploading or encoding it in a URL. */
@Injectable({ providedIn: 'root' })
export class PdfImportNavigation {
  private readonly injector = inject(Injector);
  private file: File | null = null;

  async open(file: File | null = null): Promise<void> {
    this.file = file;
    if (
      !(await this.injector
        .get(Router)
        .navigate(['/planner/editor'], { queryParams: { import: 'pdf' } }))
    ) {
      this.file = null;
      throw new Error('Could not open the PDF import workspace. Please try again.');
    }
  }

  takeFile(): File | null {
    const file = this.file;
    this.file = null;
    return file;
  }
}
