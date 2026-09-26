import { ChangeDetectionStrategy, Component, Input, OnChanges, computed, signal } from '@angular/core';

@Component({
  selector: 'div[appPhotoGallery]', standalone: true,
  templateUrl: './photo-gallery.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'room-gallery', role: 'region', '[attr.aria-label]': 'name + " photos"', '[attr.tabindex]': 'photos.length > 1 ? 0 : null', '(keydown)': 'onKey($event)', '(pointerdown)': 'pointerDown($event)', '(pointerup)': 'pointerUp($event)', '(pointercancel)': 'cancelPointer()' }
})
export class PhotoGalleryComponent implements OnChanges {
  @Input({ required: true }) name = '';
  @Input({ required: true }) photos: string[] = [];
  readonly index = signal(0);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  private start?: [number, number];
  ngOnChanges(): void { this.index.set(0); this.loaded.set(false); this.failed.set(false); }
  move(delta = 0): void { this.index.update(index => (index + delta + this.photos.length) % this.photos.length); this.loaded.set(false); this.failed.set(false); }
  onKey(event: KeyboardEvent): void {
    if (this.photos.length > 1 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); this.move(event.key === 'ArrowRight' ? 1 : -1); }
  }
  pointerDown(event: PointerEvent): void { if (this.photos.length > 1) this.start = [event.clientX, event.clientY]; }
  pointerUp(event: PointerEvent): void {
    if (this.start) { const dx = event.clientX - this.start[0], dy = event.clientY - this.start[1]; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) this.move(dx < 0 ? 1 : -1); }
    this.cancelPointer();
  }
  cancelPointer(): void { this.start = undefined; }
}
