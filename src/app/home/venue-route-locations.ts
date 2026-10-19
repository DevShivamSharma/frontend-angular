/**
 * What the Source / Destination pickers offer, ported from the ITPO app's locations.ts. Some locations are a
 * group (all gates, all halls); picking one reveals a second picker for the point, which can stay on
 * "Closest", meaning whichever point of the group gives the shortest route.
 *
 * Ids are the explorer's graph ids (venue-walkways.json). App ids that differ: conventionCentre -> cc,
 * musicalFountain -> fountain, hall12a -> hall12A. The app's food courts and `mfa` have no position in
 * the explorer's data yet, so they are not offered.
 */
export interface NavigationLocation { id: string; title: string; nodeIds: string[]; }

export const NAVIGATION_LOCATIONS: NavigationLocation[] = [
  { id: 'parking', title: 'Parking', nodeIds: ['basementParking1', 'bhaironRoadParking', 'mathuraRoadParking1', 'mathuraRoadParking2'] },
  { id: 'conventionCentre', title: 'Convention Centre', nodeIds: ['cc'] },
  { id: 'gates', title: 'Gates', nodeIds: ['gate1', 'gate3', 'gate4', 'gate5a', 'gate5b', 'gate5c', 'gate6', 'gate7', 'gate8', 'gate9', 'gate10', 'gate11'] },
  { id: 'halls', title: 'Halls', nodeIds: ['hall1', 'hall2', 'hall3', 'hall4', 'hall5', 'hall6', 'hall8', 'hall9', 'hall10', 'hall11', 'hall12', 'hall12A', 'hall14', 'hangar7a', 'hangar7b'] },
  { id: 'itpoOffice', title: 'ITPO Office', nodeIds: ['itpoAdminBlock'] },
  { id: 'amphitheatres', title: 'Amphitheatres', nodeIds: ['amphitheatre1', 'amphitheatre2', 'fountain'] },
  { id: 'busStop', title: 'Bus Stop (Gate 9)', nodeIds: ['busStop'] },
  { id: 'metro', title: 'Supreme Court Metro Station', nodeIds: ['metro'] },
];

/** Point-picker value meaning "whichever point of the group is nearest". */
export const CLOSEST_POINT = 'closest';

export interface LocationSelection { locationId: string; pointId: string; }

export const findLocation = (locationId: string | undefined, locations: NavigationLocation[]) =>
  locations.find(location => location.id === locationId);

/** The location's only point, or "closest" for a group. */
export const defaultSelection = (location: NavigationLocation): LocationSelection =>
  ({ locationId: location.id, pointId: location.nodeIds.length === 1 ? location.nodeIds[0] : CLOSEST_POINT });

/** The location that holds a graph node, as a selection naming that node. */
export function selectionForNode(nodeId: string, locations: NavigationLocation[]): LocationSelection | undefined {
  const location = locations.find(item => item.nodeIds.includes(nodeId));
  return location && { locationId: location.id, pointId: nodeId };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A live picker list when it has any usable entry, otherwise the bundled one. */
export function resolveLocations(remote: unknown): NavigationLocation[] {
  if (!Array.isArray(remote)) return NAVIGATION_LOCATIONS;
  const seen = new Set<string>(), locations: NavigationLocation[] = [];
  for (const raw of remote) {
    if (!isRecord(raw)) continue;
    const { id, title, nodeIds } = raw;
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title || !Array.isArray(nodeIds) || seen.has(id)) continue;
    const ids = [...new Set(nodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && !!nodeId))];
    if (ids.length) { seen.add(id); locations.push({ id, title, nodeIds: ids }); }
  }
  return locations.length ? locations : NAVIGATION_LOCATIONS;
}

/** Only points present in the graph; locations left with none are dropped. Junctions are never offered. */
export const availableLocations = (nodeMap: Record<string, { category: string }>, locations: NavigationLocation[]) => locations
  .map(location => ({ ...location, nodeIds: location.nodeIds.filter(id => !!nodeMap[id] && nodeMap[id].category !== 'junction') }))
  .filter(location => location.nodeIds.length > 0);
