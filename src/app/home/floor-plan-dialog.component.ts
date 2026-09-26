import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { VenueDetail } from './venue.models';
@Component({ selector: 'app-floor-plan-dialog', standalone: true, templateUrl: './floor-plan-dialog.component.html', changeDetection: ChangeDetectionStrategy.OnPush, host: { style: 'display: contents' } })
export class FloorPlanDialogComponent {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly image = viewChild.required<ElementRef<HTMLImageElement>>('image');
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');
  private readonly injector = inject(Injector);
  readonly detail = signal<VenueDetail | null>(null);
  readonly imageWidth = signal<number | null>(null);
  private zoom = 1;
  get isOpen(): boolean { return this.dialog().nativeElement.open; }
  open(detail: VenueDetail): void {
    this.detail.set(detail); this.zoom = 1;
    afterNextRender(() => { this.dialog().nativeElement.showModal(); this.fit(); }, { injector: this.injector });
  }
  close(): void { this.dialog().nativeElement.close(); }
  backdrop(event: MouseEvent): void { if (event.target === this.dialog().nativeElement) this.close(); }
  zoomIn(): void { this.zoom = Math.min(5, this.zoom * 1.4); this.fit(); }
  zoomOut(): void { this.zoom = Math.max(1, this.zoom / 1.4); this.fit(); }
  reset(): void { this.zoom = 1; this.fit(); }
  @HostListener('window:resize') resize(): void { if (this.isOpen) this.fit(); }
  fit(): void {
    const image = this.image().nativeElement, scroll = this.scroll().nativeElement;
    if (!image.naturalWidth) return;
    const fit = Math.min((scroll.clientWidth - 40) / image.naturalWidth, (scroll.clientHeight - 40) / image.naturalHeight);
    this.imageWidth.set(image.naturalWidth * fit * this.zoom);
  }
}
