import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from '../core/api-base.token';
import { Hall } from './models/hall.model';
import { Stall } from './models/stall.model';
import { buildApiPayload, LayoutApiService } from './layout-api.service';

const API = 'http://api.test/api';

const savedHall: Hall = {
  id: 9,
  name: 'Saved Hall',
  shape: 'SQUARE',
  width: 40,
  length: 40,
  radius: 0
};

function stall(overrides: Partial<Stall> = {}): Stall {
  return {
    id: 'local-1',
    hallId: 9,
    name: 'Shop 1',
    width: 8,
    length: 8,
    height: 4,
    posX: -16,
    posZ: -16,
    color: '#3498db',
    gateSide: 'FRONT',
    openSides: ['FRONT'],
    ...overrides
  };
}

describe('buildApiPayload', () => {
  it('throws when no hall is selected', () => {
    expect(() => buildApiPayload(undefined, [], '')).toThrowError('No hall selected.');
  });

  it('keeps numeric backend ids', () => {
    const payload = buildApiPayload(savedHall, [stall({ id: 42 })], 'My Layout');

    expect(payload.hall.id).toBe(9);
    expect(payload.stalls[0].id).toBe(42);
  });

  it('strips local, hall- and excel-hall- ids', () => {
    const localHall: Hall = { ...savedHall, id: 'excel-hall-1712345678901' };
    const payload = buildApiPayload(localHall, [stall({ id: 'local-1-0.5' })], 'x');

    expect('id' in payload.hall).toBe(false);
    expect('id' in payload.stalls[0]).toBe(false);
  });

  it('sends positions as posX/posZ, not database column names', () => {
    const payload = buildApiPayload(savedHall, [stall()], 'x');

    expect(payload.stalls[0].posX).toBe(-16);
    expect(payload.stalls[0].posZ).toBe(-16);
    expect(Object.keys(payload.stalls[0])).not.toContain('pos_x');
  });

  it('falls back to the hall name when the layout name is blank', () => {
    expect(buildApiPayload(savedHall, [], '   ').layoutName).toBe('Saved Hall');
    expect(buildApiPayload(savedHall, [], ' Trimmed ').layoutName).toBe('Trimmed');
  });

  it('applies stall defaults', () => {
    const payload = buildApiPayload(
      savedHall,
      [stall({ name: '   ', width: NaN, color: '', gateSide: 'sideways' as never })],
      'x'
    );

    expect(payload.stalls[0].name).toBe('Shop');
    expect(payload.stalls[0].width).toBe(5);
    expect(payload.stalls[0].color).toBe('#3498db');
    expect(payload.stalls[0].gateSide).toBe('FRONT');
  });

  it('sends openSides and syncs gateSide to the first open side', () => {
    const payload = buildApiPayload(
      savedHall,
      [stall({ gateSide: 'BACK', openSides: ['LEFT', 'BACK'] })],
      'x'
    );

    expect(payload.stalls[0].openSides).toEqual(['LEFT', 'BACK']);
    expect(payload.stalls[0].gateSide).toBe('LEFT');
  });

  it('derives openSides from gateSide for legacy single-side stalls', () => {
    const payload = buildApiPayload(
      savedHall,
      [stall({ gateSide: 'RIGHT', openSides: [] })],
      'x'
    );

    expect(payload.stalls[0].openSides).toEqual(['RIGHT']);
    expect(payload.stalls[0].gateSide).toBe('RIGHT');
  });

  it('includes hall.blockedAreas when the hall has them', () => {
    const areas = [{ posX: 0, posZ: 0, width: 10, length: 4, kind: 'wall' as const, color: '#742371' }];
    const payload = buildApiPayload({ ...savedHall, blockedAreas: areas }, [], 'x');

    expect(payload.hall.blockedAreas).toEqual(areas);
  });

  it('omits blockedAreas when the hall has none or an empty list', () => {
    expect('blockedAreas' in buildApiPayload(savedHall, [], 'x').hall).toBe(false);
    expect('blockedAreas' in buildApiPayload({ ...savedHall, blockedAreas: [] }, [], 'x').hall).toBe(false);
    expect('blockedAreas' in buildApiPayload({ ...savedHall, blockedAreas: null }, [], 'x').hall).toBe(false);
  });
});

describe('LayoutApiService', () => {
  let service: LayoutApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API }
      ]
    });

    service = TestBed.inject(LayoutApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GET /layouts accepts a bare array', async () => {
    const promise = service.list();
    http.expectOne({ url: `${API}/layouts`, method: 'GET' }).flush([{ id: 1, name: 'A' }]);

    expect(await promise).toEqual([{ id: 1, name: 'A' }]);
  });

  it('GET /layouts accepts a { layouts } wrapper', async () => {
    const promise = service.list();
    http.expectOne(`${API}/layouts`).flush({ layouts: [{ id: 2, name: 'B' }] });

    expect(await promise).toEqual([{ id: 2, name: 'B' }]);
  });

  it('GET /layouts returns an empty list for an unexpected body', async () => {
    const promise = service.list();
    http.expectOne(`${API}/layouts`).flush({});

    expect(await promise).toEqual([]);
  });

  it('POST /layout/save sends the payload', async () => {
    const payload = buildApiPayload(savedHall, [stall()], 'My Layout');
    const promise = service.save(payload);

    const req = http.expectOne({ url: `${API}/layout/save`, method: 'POST' });
    expect(req.request.body).toEqual(payload);
    req.flush({ id: 5 });

    expect(await promise).toEqual({ id: 5 });
  });

  it('GET /layout/{id}', async () => {
    const promise = service.open(5);
    http.expectOne({ url: `${API}/layout/5`, method: 'GET' }).flush({ hall: savedHall });

    expect((await promise).hall).toEqual(savedHall);
  });

  it('PUT /layout/{id}', async () => {
    const payload = buildApiPayload(savedHall, [], 'x');
    const promise = service.update(5, payload);

    const req = http.expectOne({ url: `${API}/layout/5`, method: 'PUT' });
    expect(req.request.body).toEqual(payload);
    req.flush({ ok: true });

    await expectAsync(promise).toBeResolvedTo({ ok: true });
  });

  it('DELETE /layout/{id}', async () => {
    const promise = service.delete(5);
    http.expectOne({ url: `${API}/layout/5`, method: 'DELETE' }).flush({ ok: true });

    await expectAsync(promise).toBeResolvedTo({ ok: true });
  });
});
