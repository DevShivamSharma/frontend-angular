/** What creating a hall answers with. */
export interface CreatedHall {
  hallId: number;
  layoutId: number;
  name: string;
  width: number;
  depth: number;
  /** Floor area in square metres: width times depth. */
  area: number;
  hallAreaCapacity: number;
  /** The pictures saved with it. */
  images: SavedHallImage[];
}

/** A picture as the create and add calls answer with it. */
export interface SavedHallImage {
  documentId: number;
  url: string;
  kind: HallImageKind;
}

export type HallImageKind = 'cover' | 'gallery';

/** A picture of a hall, as ITPO lists it (it is kept as a document, its URL being its path). */
export interface HallImage {
  documentId: number;
  name: string;
  url: string;
  kind: HallImageKind;
}

export interface HallResource {
  name: string;
  type: string;
  description: string | null;
}

export interface HallCategory {
  id: number;
  name: string;
}

/** A hall as ITPO's hall list gives it (the fields this portal shows). */
export interface ItpoHall {
  id: number;
  name: string;
  description?: string | null;
  hallAreaCapacity: number | null;
  hallCategory: HallCategory | null;
  isVipLounge: boolean;
  isAvailableForFnB: boolean;
  /** Stalls may also be planned in the hall's foyer. */
  isAvailableForFoyr: boolean;
  complementaryDays: number | null;
  sortOrder: number | null;
  isActive: boolean;
  isPopular: boolean;
  isAvailableForBooking: boolean;
  hallCode: number | null;
  hallIncharge: string | null;
  financeOfficer: string | null;
  images: HallImage[];
  resources: HallResource[];
  createdAt: string | null;
  updatedAt: string | null;
  /** Every field the list returned, for the detail row. */
  raw: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface HallListQuery {
  page: number;
  size: number;
  search?: string;
}
