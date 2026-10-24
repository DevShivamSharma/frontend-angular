/** A group of categories ITPO keeps together: a fair's product categories, F&B, branding. */
export interface CategoryGroup {
  id: number;
  name: string;
  slug: string;
}

/** A product category: one entry of a group. */
export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
}

export interface CategoryQuery {
  group: string;
  page: number;
  size: number;
  search?: string;
  /** Which to list: every one, or only the active or the inactive. */
  status: 'all' | 'active' | 'inactive';
}

export interface NewCategory {
  name: string;
  description?: string;
}
