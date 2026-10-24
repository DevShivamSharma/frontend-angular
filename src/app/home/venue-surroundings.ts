import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildSurroundingBuildings } from './venue-surroundings-buildings';
import { buildSurroundingRailways } from './venue-surroundings-rail';
import type { Point } from './venue-surroundings-geometry';

export { insideSurroundings } from './venue-surroundings-geometry';
export interface SurroundingBuilding { id: number; p: Point[]; holes?: Point[][]; h: number; base: number; roof: string; wall: string; station?: boolean; floors?: number; }
export interface SurroundingRailway { id: number; p: Point[]; y: number; w: number; gauge: number; metro: boolean; }
export interface VenueSurroundings { coverage: Point[]; buildings: SurroundingBuilding[]; railways: SurroundingRailway[]; }

/** Lit 3D volumes stay visible at distance; only small architectural and track details use LOD. */
export function createVenueSurroundings(data: VenueSurroundings) {
  const group = new T.Group(); group.name = 'OSM modeled surroundings (Color → Map)';
  const materials: T.MeshStandardMaterial[] = [];
  function batch(parts: T.BufferGeometry[], name: string, shadows = false, glazing = false): T.Object3D {
    if (!parts.length) return new T.Group();
    const geometry = mergeGeometries(parts, false); parts.forEach(part => part.dispose());
    if (!geometry) throw new Error('Incompatible surroundings geometry');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = new T.MeshStandardMaterial({ vertexColors: true, transparent: true,
      roughness: glazing ? .38 : .88, metalness: glazing ? .15 : 0, envMapIntensity: .35 });
    materials.push(material);
    const mesh = new T.Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.renderOrder = -1;
    return mesh;
  }
  const buildings = buildSurroundingBuildings(data.buildings), railway = buildSurroundingRailways(data.railways);
  const architecture = new T.LOD(), tracks = new T.LOD(), detail = new T.Group();
  detail.add(batch(buildings.detail, 'Roof parapets, floor bands and window sills'), batch(buildings.windows, 'Facade window panels', false, true));
  architecture.addLevel(detail, 0); architecture.addLevel(new T.Group(), 2400, .12);
  tracks.addLevel(batch(railway.detail, 'Railway sleepers · near LOD'), 0); tracks.addLevel(new T.Group(), 2000, .12);
  group.add(batch(buildings.volumes, 'OSM building volumes and metro station', true), architecture,
    batch(railway.beds, 'Raised ballast, metro decks and steel rails'), batch(railway.structures, 'Metro parapets and bridge piers', true), tracks);
  return { group, update(camera: T.PerspectiveCamera, opacity: number) {
    architecture.update(camera); tracks.update(camera);
    for (const material of materials) material.opacity = opacity;
  } };
}
