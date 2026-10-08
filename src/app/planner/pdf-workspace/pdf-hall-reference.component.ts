import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Hall } from '../models/hall.model';
import { hallSignature, pdfReferenceCrop, type PdfHallBinding, type PdfPlanTexture, type PdfFloorPlan } from './pdf-hall-plan';
import { hashPdf, listHallBindings, loadWorkspace } from './pdf-workspace.storage';

@Component({
  selector: 'app-pdf-hall-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (binding(); as source) {
      <section class="reference" aria-label="PDF hall reference">
        <strong>PDF hall reference</strong>
        @if (texture()) {
          <label
            ><input
              type="checkbox"
              [checked]="visible()"
              (change)="toggle($any($event.target).checked)"
            />
            Show original drawing</label
          >
        }
        <p role="status">{{ status() }}</p>
        <a routerLink="/planner/editor" [queryParams]="{ import: 'pdf', document: source.documentId }"
          >Open original PDF / import another hall</a
        >
        <details>
          <summary>Reference details</summary>
          <small
            >PDF and review objects are stored in this browser.
            {{
              localPreview()
                ? 'This hall is a local preview; it has not been saved to the server.'
                : 'Only the hall boundary is saved to the server.'
            }}
            Download a PDF project backup before clearing site data.</small
          >
        </details>
      </section>
    } @else if (status()) {
      <p role="status">{{ status() }}</p>
    }
  `,
  styles: [
    `
      .reference {
        display: grid;
        gap: 8px;
        padding: 12px;
        margin-top: 12px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #f8fafc;
        color: #334155;
        font-size: 13px;
      }
      label {
        display: flex;
        align-items: center;
        gap: 7px;
        cursor: pointer;
      }
      p {
        margin: 0;
        line-height: 1.45;
      }
      small {
        font-size: 12px;
        line-height: 1.45;
      }
      a {
        color: #1d4ed8;
        text-underline-offset: 3px;
      }
      input {
        accent-color: #2563eb;
      }
      summary {
        cursor: pointer;
      }
      small {
        display: block;
        margin-top: 6px;
      }
      a:focus-visible,
      input:focus-visible,
      summary:focus-visible {
        outline: 2px solid #1d4ed8;
        outline-offset: 3px;
      }
    `,
  ],
})
export class PdfHallReferenceComponent {
  readonly hall = input<Hall>();
  readonly floorPlan = input<PdfFloorPlan | null>(null);
  readonly initiallyVisible = input(true);
  readonly reference = output<PdfPlanTexture | null>();
  readonly binding = signal<PdfHallBinding | null>(null);
  readonly texture = signal<PdfPlanTexture | null>(null);
  readonly visible = signal(true);
  readonly status = signal('');
  readonly localPreview = signal(false);
  private generation = 0;
  private release: (() => void) | undefined;

  constructor() {
    effect(() => {
      const hall = this.hall();
      this.floorPlan();
      untracked(() => void this.load(hall));
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation++;
      this.release?.();
    });
  }

  toggle(visible: boolean): void {
    this.visible.set(visible);
    const value = this.texture();
    this.reference.emit(value ? { ...value, canvas: visible ? value.canvas : null } : null);
  }

  private async load(hall: Hall | undefined): Promise<void> {
    const generation = ++this.generation;
    this.release?.();
    this.release = undefined;
    this.binding.set(null);
    this.texture.set(null);
    this.status.set('');
    this.reference.emit(null);
    this.visible.set(this.initiallyVisible());
    if (!hall) return;
    this.localPreview.set(String(hall.id).startsWith('pdf-local-'));
    let reader: import('./pdf-reader').PdfReader | undefined;
    try {
      const links = await listHallBindings();
      if (generation !== this.generation) return;
      const signature = hallSignature(hall);
      const candidates = links.filter((link) => link.hallSignature === signature);
      const mappings = new Set(
        candidates.map((link) =>
          JSON.stringify([link.sha256, link.page, link.crop, link.metresPerUnit]),
        ),
      );
      const direct = links.find((link) => link.hallId === String(hall.id));
      if (!direct && mappings.size > 1) {
        this.status.set(
          'More than one local PDF matches this hall. Open the intended PDF workspace to review its reference.',
        );
        return;
      }
      const binding = direct ?? candidates[0];
      if (!binding) return;
      this.binding.set(binding);
      const { crop, centre } = pdfReferenceCrop({ ...binding, hallId: String(hall.id) }, this.floorPlan());
      const frame = {
        hallId: String(hall.id),
        width: crop.width * binding.metresPerUnit,
        length: crop.height * binding.metresPerUnit,
        centre,
        canvas: null,
      };
      this.reference.emit(frame);
      if (binding.hallSignature !== signature) {
        this.status.set(
          'Hall geometry changed after import. The PDF overlay is hidden to avoid showing a false alignment.',
        );
        return;
      }
      this.status.set('Loading local PDF reference…');
      const doc = await loadWorkspace(binding.documentId);
      if (!doc)
        throw new Error(
          'The source PDF is missing in this browser. Restore your backup in the PDF workspace and import the hall again to link it.',
        );
      if ((await hashPdf(doc.pdf)) !== binding.sha256)
        throw new Error('The source PDF failed its integrity check.');
      if (generation !== this.generation) return;
      const { PdfReader } = await import('./pdf-reader');
      if (generation !== this.generation) return;
      reader = new PdfReader();
      const activeReader = reader;
      this.release = () => {
        void activeReader.destroy();
      };
      await reader.open(doc.pdf);
      if (generation !== this.generation) return;
      await reader.selectPage(binding.page);
      const canvas = document.createElement('canvas');
      // A bounded floor texture is a preview. Full detail is available in the zoomable PDF workspace.
      const scale =
        2048 / (Math.max(crop.width, crop.height) * Math.min(window.devicePixelRatio || 1, 2));
      await reader.render(
        canvas,
        scale,
        crop.x * scale,
        crop.y * scale,
        crop.width * scale,
        crop.height * scale,
      );
      if (generation !== this.generation) return;
      const texture = { ...frame, canvas };
      this.texture.set(texture);
      this.reference.emit({ ...texture, canvas: this.visible() ? canvas : null });
      this.status.set('Calibrated PDF crop. Open the original for the full page and legends.');
    } catch (error) {
      if (generation === this.generation)
        this.status.set(
          error instanceof Error ? error.message : 'Could not load the PDF reference.',
        );
    } finally {
      await reader?.destroy();
      if (generation === this.generation) this.release = undefined;
    }
  }
}
