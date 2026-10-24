export interface HallField {
  label: string;
  value: string;
}

/** Fields that only hold ITPO's own bookkeeping or are shown elsewhere in the row. */
const HIDDEN = new Set([
  'id',
  'name',
  'imageHall',
  'hallCategoryId',
  // Shown in full on the page, or only an id of ITPO's own bookkeeping.
  'description',
  'resources',
  'createdBy',
  'updatedBy',
  'hallPriceData',
]);

/** "isAvailableForFnB" -> "Is available for fn b" (words split at capitals, first one capitalised). */
export function humanize(key: string): string {
  const words = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One value as text: yes/no for flags, a date as a date, a nested object by its name. */
export function describeValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value.length ? `${value.length} item${value.length === 1 ? '' : 's'}` : null;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = record['categoryName'] ?? record['category_name'] ?? record['name'];
    return typeof name === 'string' ? name : null;
  }
  if (typeof value === 'string' && /(At|Date)$/.test(key) && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  return String(value);
}

/** Every field the hall list returned for a hall, as label and text, leaving out the empty ones. */
export function describeHall(raw: Record<string, unknown>): HallField[] {
  return Object.entries(raw)
    .filter(([key]) => !HIDDEN.has(key))
    .flatMap(([key, value]) => {
      const text = describeValue(key, value);
      return text === null ? [] : [{ label: humanize(key), value: text }];
    });
}
