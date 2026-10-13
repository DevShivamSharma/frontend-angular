/** Mirrors the backend's stall categories (Module E). */
export type CategoryStatus = 'active' | 'inactive';

export interface CategoryView {
  id: string;
  name: string;
  status: CategoryStatus;
  /** Event halls that sell it; such a category can be made inactive but not deleted. */
  eventHalls: number;
  /** The venue system's id for it (T_CODE_MASTER). */
  itpoId: string | null;
  updatedAt: string;
}

/** A category as an event hall or a stall shows it. */
export interface CategoryRef {
  id: string;
  name: string;
  status: CategoryStatus;
}

export interface CategoryInput {
  name: string;
  status?: CategoryStatus;
  itpoId?: string | null;
}

export interface CategoryImportResult {
  created: number;
  skipped: Array<{ name: string; reason: string }>;
}
