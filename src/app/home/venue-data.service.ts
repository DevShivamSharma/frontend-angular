import { Injectable, OnDestroy } from '@angular/core';
import { Destination, Hall, HallFloor, Room, VenueDetail, VenueInformation, venueAsset } from './venue.models';

export const ROOMS_API = 'https://api.indiatradefair.com/cc/itpo/api/v1/rooms/usr/room/all';
export const HALL_APIS = [1, 2, 3].map(category => `https://api.indiatradefair.com/admin/itpo/api/v1/halls?hallCategory=${category}&size=100`);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const photoUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && /\.(jpe?g|png|webp|avif)$/i.test(url.pathname); } catch { return false; }
};
function list(payload: unknown, kind: 'room' | 'hall'): unknown[] {
  const raw = record(payload), data = record(raw['data']);
  if (record(raw['header'])['error'] || !Array.isArray(data['list'])) throw new Error(`Invalid ${kind} response`);
  if (kind === 'hall' && Number(data['total']) > data['list'].length) throw new Error('Incomplete hall response');
  return data['list'];
}
export function normalizeRooms(payload: unknown): Room[] {
  const seen = new Set<unknown>();
  return list(payload, 'room').flatMap(value => {
    const room = record(value), level = Number(/^level\s*([123])$/i.exec(String(room['level']).trim())?.[1]);
    if (!level || room['isActive'] === false || !room['name'] || seen.has(room['id'])) return [];
    seen.add(room['id']);
    const number = (value: unknown) => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    return [{ id: String(room['id']), name: String(room['name']), level, area: number(room['area']), capacity: number(room['seatingCapacity']), photos: [...new Set((Array.isArray(room['roomDocs']) ? room['roomDocs'] : []).filter(photoUrl))] }];
  });
}
export function parseHallIdentity(value: unknown): { halls: string[]; floor: 'GF' | 'FF' | null } | null {
  const match = /^hall[\s_-]*(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)*)\s*(GF|FF)?$/i.exec(String(value).trim());
  return match ? { halls: match[1].toUpperCase().split(/\s*[-–]\s*/), floor: match[2]?.toUpperCase() as 'GF' | 'FF' || null } : null;
}
export function normalizeHalls(payloads: unknown[]): Hall[] {
  const records: Hall[] = [], seen = new Set<string>();
  for (const payload of payloads) for (const value of list(payload, 'hall')) {
    const hall = record(value);
    if (hall['isActive'] === false) continue;
    const identity = parseHallIdentity(hall['subHosterCode']) || parseHallIdentity(hall['name']);
    if (!identity) continue;
    const category = record(hall['hallCategory']), categoryId = Number(category['id']);
    const floor: HallFloor = identity.floor || ({ 1: 'GF', 2: 'FF' } as Record<number, HallFloor>)[categoryId] || 'details';
    const id = String(hall['id'] ?? identity.halls.join('-') + '-' + floor);
    if (seen.has(id)) continue;
    seen.add(id);
    const photos = [...new Set((Array.isArray(hall['imageHall']) ? hall['imageHall'] : []).map(record).filter(doc => doc['documentType'] !== 'hallLayout').map(doc => String(doc['documentUrl'] || '').trim()).filter(photoUrl))];
    const rawArea = hall['hallAreaCapacity'];
    const area = rawArea !== null && rawArea !== undefined && rawArea !== '' && Number.isFinite(Number(rawArea)) && Number(rawArea) >= 0 ? Number(rawArea) : null;
    records.push({ id, name: String(hall['name'] || 'Hall ' + identity.halls.join('–')), halls: identity.halls, floor, area, photos, category: String(category['name'] || 'Exhibition hall') });
  }
  const rank: Record<HallFloor, number> = { GF: 0, FF: 1, details: 2 };
  return records.sort((a, b) => rank[a.floor] - rank[b.floor] || a.name.localeCompare(b.name));
}

/** Provided by HomePageComponent: caches and pending requests belong to one visit. */
@Injectable()
export class VenueDataService implements OnDestroy {
  private readonly lifetime = new AbortController();
  private rooms?: Room[];
  private halls?: Hall[];
  private pendingRooms?: Promise<Room[]>;
  private pendingHalls?: Promise<Hall[]>;
  private async request(url: string): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15000)]), credentials: 'same-origin' });
    if (!response.ok) throw new Error('Venue information unavailable');
    return response.json();
  }
  async loadInformation(): Promise<VenueInformation> {
    const [destinations, details] = await Promise.all(['venue-navigation.json', 'venue-details.json?v=rooms-1'].map(path => this.request(venueAsset(path)))) as [Destination[], Record<string, VenueDetail>];
    for (const detail of Object.values(details)) detail.plan = venueAsset(detail.plan);
    return { destinations, details };
  }
  loadRooms(): Promise<Room[]> {
    if (this.rooms) return Promise.resolve(this.rooms);
    return this.pendingRooms ??= this.request(ROOMS_API).then(payload => this.rooms = normalizeRooms(payload)).finally(() => { this.pendingRooms = undefined; });
  }
  loadHalls(): Promise<Hall[]> {
    if (this.halls) return Promise.resolve(this.halls);
    return this.pendingHalls ??= Promise.allSettled(HALL_APIS.map(url => this.request(url))).then(results => {
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      return this.halls = normalizeHalls(results.map(result => (result as PromiseFulfilledResult<unknown>).value));
    }).finally(() => { this.pendingHalls = undefined; });
  }
  ngOnDestroy(): void { this.lifetime.abort(); }
}
