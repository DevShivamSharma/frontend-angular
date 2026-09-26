import { TestBed } from '@angular/core/testing';
import { PhotoGalleryComponent } from './photo-gallery.component';

describe('PhotoGalleryComponent', () => {
  const photo = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  async function gallery(photos = [photo + '#1', photo + '#2']) {
    await TestBed.configureTestingModule({ imports: [PhotoGalleryComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PhotoGalleryComponent);
    fixture.componentRef.setInput('name', 'Hall 1');fixture.componentRef.setInput('photos', photos);fixture.detectChanges();
    return fixture;
  }
  it('renders Angular-bound counters and wraps on click and keyboard', async () => {
    const fixture = await gallery(), el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.next') as HTMLButtonElement).click();fixture.detectChanges();
    expect(el.querySelector('.room-photo-count')!.textContent!.trim()).toBe('2 / 2');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));fixture.detectChanges();
    expect(fixture.componentInstance.index()).toBe(0);
    expect(el.querySelector('img')!.alt).toBe('Hall 1 · photo 1 of 2');
  });
  it('keeps the original horizontal swipe threshold and cancels abandoned gestures', async () => {
    const fixture = await gallery(), instance = fixture.componentInstance;
    instance.pointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 10 }));
    instance.pointerUp(new PointerEvent('pointerup', { clientX: 60, clientY: 10 }));expect(instance.index()).toBe(0);
    instance.pointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 10 }));
    instance.pointerUp(new PointerEvent('pointerup', { clientX: 40, clientY: 10 }));expect(instance.index()).toBe(1);
    instance.pointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 10 }));instance.cancelPointer();
    instance.pointerUp(new PointerEvent('pointerup', { clientX: 40, clientY: 10 }));expect(instance.index()).toBe(1);
  });
  it('shows the source image error and empty states', async () => {
    const fixture = await gallery(), el: HTMLElement = fixture.nativeElement;
    el.querySelector('img')!.dispatchEvent(new Event('error'));fixture.detectChanges();
    expect(el.querySelector('img')!.hidden).toBeTrue();
    expect(el.querySelector('.room-photo-placeholder')!.textContent).toContain('Photo unavailable');
    fixture.componentRef.setInput('photos', []);fixture.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.room-photo-placeholder')!.textContent).toContain('Photos not available');
  });
});
