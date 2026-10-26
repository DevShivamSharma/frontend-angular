export type Triple = [number, number, number];
export interface Destination { id: string; hall?: string; gate?: string; label: string; center: Triple; camera?: Triple; target?: Triple; radius?: number; source_object?: string; }
export interface VenueDetail { title: string; subtitle: string; description: string; plan: string; facts: [string, string][]; }
export interface VenueInformation { destinations: Destination[]; details: Record<string, VenueDetail>; }
export interface Room { id: string; name: string; level: number; area: number | null; capacity: number | null; photos: string[]; }
export type HallFloor = 'GF' | 'FF' | 'details';
export interface Hall { id: string; name: string; halls: string[]; floor: HallFloor; area: number | null; photos: string[]; category: string; }
export const FLOOR_NAMES: Record<HallFloor, string> = { GF: 'Ground Floor', FF: 'First Floor', details: 'Hall details' };
export const LEVEL_NAMES = ['', 'Ground floor', 'Podium level', 'Plenary level'];
/**
 * The one place that names the explorer's main 3D model, under src/assets/venue/.
 * `file` is tried first; `fallback` (when set) is the plain export used if `file` cannot be fetched or decoded.
 * `kind` selects the preparation passes: the earlier hand-built model or the Bharat Mandapam CAD model.
 * Going back to the earlier model is this one line: VENUE_MODEL = PREVIOUS_VENUE_MODEL.
 */
export type VenueModelKind = 'iitf-architectural' | 'bharat-mandapam';
export interface VenueModelSource { file: string; fallback?: string; kind: VenueModelKind; }
export const PREVIOUS_VENUE_MODEL: VenueModelSource = {
    file: 'IITF_2026_ARCHITECTURAL.meshopt.glb?v=outputs-20260927',
    fallback: 'IITF_2026_ARCHITECTURAL.glb?v=outputs-20260927',
    kind: 'iitf-architectural'
};
/** scripts/prepare-bharat-mandapam.mjs output: stacked duplicates removed, frame baked in (Git LFS). */
export const BHARAT_MANDAPAM_MODEL: VenueModelSource = {
    file: 'bharat-mandapam.meshopt.glb?v=20261026',
    kind: 'bharat-mandapam'
};
export const VENUE_MODEL: VenueModelSource = BHARAT_MANDAPAM_MODEL;
export function venueAsset(path: string): string { return new URL('assets/venue/' + path, document.baseURI).href; }
