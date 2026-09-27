import { TestBed } from '@angular/core/testing';
import { RoomBrowserComponent } from './room-browser.component';
import { VenueDataService } from './venue-data.service';
import { Room } from './venue.models';

describe('RoomBrowserComponent', () => {
  it('renders the selected level through Angular and emits tab selections', async () => {
    const rooms: Room[] = [1, 2].map(level => ({ id: String(level), name: 'Room ' + level, level, area: 120, capacity: 30, photos: [] }));
    await TestBed.configureTestingModule({ imports: [RoomBrowserComponent], providers: [{ provide: VenueDataService, useValue: { loadRooms: () => Promise.resolve(rooms) } }] }).compileComponents();
    const fixture = TestBed.createComponent(RoomBrowserComponent);
    fixture.componentRef.setInput('level', 2);fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.room-card').length).toBe(1);
    expect(el.querySelector('h3')!.textContent).toBe('Room 2');
    const emit = spyOn(fixture.componentInstance.levelChange, 'emit');
    (el.querySelector('.room-level-tabs button') as HTMLButtonElement).click();expect(emit).toHaveBeenCalledWith(1);
  });
  it('ignores a directory response after destruction', async () => {
    let resolve!: (rooms: Room[]) => void;
    await TestBed.configureTestingModule({ imports: [RoomBrowserComponent], providers: [{ provide: VenueDataService, useValue: { loadRooms: () => new Promise<Room[]>(done => resolve = done) } }] }).compileComponents();
    const fixture = TestBed.createComponent(RoomBrowserComponent);
    fixture.componentRef.setInput('level', 1);fixture.detectChanges();const instance = fixture.componentInstance;fixture.destroy();
    resolve([{ id: 'late', name: 'Late', level: 1, area: null, capacity: null, photos: [] }]);await Promise.resolve();
    expect(instance.rooms()).toEqual([]);
  });
});
