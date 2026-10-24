/** One entry of the portal's main navigation. */
export interface NavItem {
  label: string;
  /** A PrimeIcons class. */
  icon: string;
  route: string;
  /** The heading it is listed under. */
  group: string;
  /** Only ITPO staff see it. */
  staffOnly: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Internal events',
    icon: 'pi-calendar',
    route: '/events',
    group: 'Events',
    staffOnly: true,
  },
  {
    label: 'External events',
    icon: 'pi-calendar-plus',
    route: '/external-events',
    group: 'Events',
    staffOnly: false,
  },
  { label: 'Halls', icon: 'pi-building', route: '/halls', group: 'Setup', staffOnly: true },
  {
    label: 'Categories',
    icon: 'pi-tags',
    route: '/categories',
    group: 'Setup',
    staffOnly: true,
  },
  {
    label: 'Planning rules',
    icon: 'pi-sliders-h',
    route: '/rules',
    group: 'Setup',
    staffOnly: true,
  },
];

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** The items a user may see, under their headings in the order the headings first appear. */
export function groupNav(items: readonly NavItem[]): NavGroup[] {
  const groups = new Map<string, NavItem[]>();
  for (const item of items) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }
  return [...groups].map(([title, grouped]) => ({ title, items: grouped }));
}
