export type Triple = [number, number, number];
export interface Destination { id: string; hall?: string; gate?: string; label: string; center: Triple; camera?: Triple; target?: Triple; radius?: number; source_object?: string; }
export interface VenueDetail { title: string; subtitle: string; description: string; plan: string; facts: [string, string][]; }
export interface VenueInformation { destinations: Destination[]; details: Record<string, VenueDetail>; }
export interface Room { id: string; name: string; level: number; area: number | null; capacity: number | null; photos: string[]; }
export type HallFloor = 'GF' | 'FF' | 'details';
export interface Hall { id: string; name: string; halls: string[]; floor: HallFloor; area: number | null; photos: string[]; category: string; }
export const FLOOR_NAMES: Record<HallFloor, string> = { GF: 'Ground Floor', FF: 'First Floor', details: 'Hall details' };
export const LEVEL_NAMES = ['', 'Ground floor', 'Podium level', 'Plenary level'];
export function venueAsset(path: string): string { return new URL('assets/venue/' + path, document.baseURI).href; }
