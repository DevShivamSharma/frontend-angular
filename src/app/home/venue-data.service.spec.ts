import { VenueDataService, normalizeRooms, normalizeHalls, parseHallIdentity } from './venue-data.service';

describe('Venue directory conversion', () => {
  it('preserves room filtering, deduplication, numeric conversion and safe photos', () => {
    const result = normalizeRooms({ data: { list: [
      { id: 1, name: 'Meeting room', level: ' Level 2 ', area: '125', seatingCapacity: null, roomDocs: ['https://example.com/a.jpg', 'https://example.com/a.jpg', 'http://example.com/b.jpg', 'https://example.com/not-photo.pdf'] },
      { id: 1, name: 'Duplicate', level: 'Level 2' },
      { id: 2, name: 'Inactive', level: 'Level 1', isActive: false },
      { id: 3, name: 'Bad level', level: 'Level 4' }
    ] } });
    expect(result).toEqual([{ id: '1', name: 'Meeting room', level: 2, area: 125, capacity: null, photos: ['https://example.com/a.jpg'] }]);
  });
  it('keeps shared halls, 12A identity, floor ordering and plan/photo distinction', () => {
    expect(parseHallIdentity('Hall 8–10 GF')).toEqual({ halls: ['8', '10'], floor: 'GF' });
    expect(parseHallIdentity('Hall_12A FF')).toEqual({ halls: ['12A'], floor: 'FF' });
    const result = normalizeHalls([{ data: { total: 2, list: [
      { id: 2, name: 'Hall 12A FF', hallAreaCapacity: 120, imageHall: [] },
      { id: 1, name: 'Hall 8-10 GF', imageHall: [{ documentType: 'hallLayout', documentUrl: 'https://example.com/plan.png' }, { documentUrl: 'https://example.com/photo.jpg' }] }
    ] } }]);
    expect(result.map(h => h.floor)).toEqual(['GF', 'FF']);
    expect(result[0].halls).toEqual(['8', '10']);
    expect(result[0].photos).toEqual(['https://example.com/photo.jpg']);
    expect(result[1].halls).toEqual(['12A']);
  });
  it('rejects incomplete or invalid directory responses so the loading gate offers retry', () => {
    expect(() => normalizeRooms({ header: { error: true }, data: { list: [] } })).toThrow();
    expect(() => normalizeHalls([{ data: { total: 3, list: [] } }])).toThrowError('Incomplete hall response');
  });
  it('shares pending requests and caches the successful directory within one visit', async () => {
    const fetchSpy = spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ data: { list: [] } })));
    const service = new VenueDataService();
    const first = service.loadRooms();expect(service.loadRooms()).toBe(first);
    await first;await service.loadRooms();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const signal = (fetchSpy.calls.first().args[1] as RequestInit).signal!;
    service.ngOnDestroy();expect(signal.aborted).toBeTrue();
  });
});
