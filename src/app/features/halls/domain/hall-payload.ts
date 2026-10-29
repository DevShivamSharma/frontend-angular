import { HallImageKind } from '../data/halls.models';
import { NotesPayload } from './hall-notes';
import { Corner } from './hall-shape.model';
import { extent } from './outline-geometry';

/** What the user chose for a new hall, apart from its shape. */
export interface HallDetails {
  name: string;
  hallCategoryId: number | null;
  hallAreaCapacity: number | null;
  isPopular: boolean;
  isVipLounge: boolean;
  isAvailableForFnB: boolean;
  complimentaryDays: 0 | 1;
  sortOrder: number | null;
}

/** A picture in the create-hall call: the URL it is kept at, and whether it is the cover. */
export interface HallImagePayload {
  url: string;
  kind: HallImageKind;
}

/** The body of the API's create-hall call. */
export interface CreateHallPayload {
  name: string;
  width: number;
  depth: number;
  outline?: Corner[];
  hallCategoryId?: number;
  hallAreaCapacity?: number;
  isPopular?: boolean;
  isVipLounge?: boolean;
  isAvailableForFnB?: boolean;
  complementaryDays?: number;
  sortOrder?: number;
  images?: HallImagePayload[];
  notes?: NotesPayload;
}

/**
 * The create-hall call for a hall: its size from the outline's box, the outline itself unless the
 * hall is a plain rectangle (which needs none), and the optional details only when they were given.
 * An NTA hall has no VIP lounge, F&B, complementary days or order, as in SelfCare.
 */
export function buildHallPayload(
  details: HallDetails,
  ring: readonly Corner[],
  isNta: boolean,
  images: readonly HallImagePayload[] = [],
  notes?: NotesPayload,
): CreateHallPayload {
  const { width, depth } = extent(ring);
  const payload: CreateHallPayload = { name: details.name.trim(), width, depth };

  if (!isRectangle(ring, width, depth)) {
    payload.outline = ring.map(([x, y]): Corner => [x, y]);
  }
  if (details.hallCategoryId !== null) payload.hallCategoryId = details.hallCategoryId;
  if (details.hallAreaCapacity !== null) payload.hallAreaCapacity = details.hallAreaCapacity;
  if (details.isPopular) payload.isPopular = true;
  if (images.length) payload.images = images.map((image) => ({ ...image }));
  if (notes) payload.notes = notes;

  if (!isNta) {
    if (details.isVipLounge) payload.isVipLounge = true;
    if (details.isAvailableForFnB) payload.isAvailableForFnB = true;
    if (details.complimentaryDays) payload.complementaryDays = details.complimentaryDays;
    if (details.sortOrder !== null) payload.sortOrder = details.sortOrder;
  }
  return payload;
}

function isRectangle(ring: readonly Corner[], width: number, depth: number): boolean {
  if (ring.length !== 4) return false;
  return ring.every(([x, y]) => (x === 0 || x === width) && (y === 0 || y === depth));
}
