import { CategoryGroup } from '../data/categories.models';

/** ITPO keeps all its lists of values (roles, states, hall types…) as groups too; these are not categories. */
const NOT_CATEGORIES: ReadonlySet<string> = new Set([
  'role',
  'organiser_types',
  'domestic_organiser',
  'company_type',
  'related_party_type',
  'country',
  'state',
  'district',
  'booking_period',
  'hall_types',
  'designation',
  'event_type',
]);

/** The groups that hold categories, by name. */
export function categoryGroups(groups: readonly CategoryGroup[]): CategoryGroup[] {
  return groups
    .filter((group) => !NOT_CATEGORIES.has(group.slug))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The slug ITPO stores a category under: its name in lower case, words joined by dashes. */
export function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
}
