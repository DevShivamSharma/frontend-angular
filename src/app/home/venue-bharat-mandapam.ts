import * as T from 'three';
import type { Destination, Triple } from './venue.models';

/**
 * The Bharat Mandapam CAD model (scripts/prepare-bharat-mandapam.mjs) carries DWG-layer names and no glTF extras.
 * This pass gives it the metadata the explorer reads from the earlier model: material categories, the hall, gate,
 * CC and fountain each mesh belongs to, and a few roles (hall roof, walkable ground, water, low planting).
 * It runs once, right after loading and before any other pass. Mapping table: docs/venue-model-swap.md.
 */

/** architecturalCategory per material, by the model's own material names (75 materials, no textures). */
export const BHARAT_MANDAPAM_CATEGORIES: Readonly<Record<string, string>> = {
  'landscape': 'landscape', 'Grass / planted terrace': 'landscape',
  'Detailed foliage 0': 'landscape', 'Detailed foliage 1': 'landscape', 'Detailed foliage 2': 'landscape', 'Detailed foliage 3': 'landscape',
  'Tree trunks': 'tree_bark',
  'Charcoal roof / canopy': 'structure', 'Light structural steel': 'structure', 'Canopy warm bronze underside': 'structure',
  'Gate 9 galvanised painted steel': 'structure',
  'Light stone coping': 'stone', 'Agra sandstone · photograph palette': 'stone', 'D Block muted buff sandstone': 'stone',
  'D Block pale stone courses': 'stone', 'Forecourt shaft recessed panel · untextured reference pending': 'stone',
  'Ventilation grille · pale stone white': 'stone', 'Admin curb charcoal': 'stone', 'Admin curb ochre yellow': 'stone',
  'Blue-grey reflective glazing': 'glazing', 'D Block dark recessed windows': 'glazing',
  'Admin rooftop equipment off-white': 'service', 'D Block rooftop plant': 'service',
  'Admin roof pale weathered surface': 'roof', 'D Block roof membrane': 'roof', 'D Block observed dark roof strips': 'roof',
  'Hall roof · muted red from drone': 'roof', 'Older halls · warm roof finish': 'roof', 'Pale metal roof': 'roof',
  'Hall cladding 0': 'facade', 'Hall cladding 1': 'facade', 'Hall cladding 2': 'facade', 'Hall cladding 3': 'facade',
  'Hall cladding 4': 'facade', 'Hall cladding 5': 'facade',
  'Fountain water': 'water', 'water': 'water', 'Reflecting pool subdued water': 'water',
  'Reflecting pool dark granite': 'basalt',
  'Section paving stone 0': 'paved_ground', 'Section paving stone 1': 'paved_ground', 'Section paving stone 2': 'paved_ground',
  'Section paving stone 3': 'paved_ground', 'Convention plaza warm stone 0': 'paved_ground', 'Convention plaza warm stone 1': 'paved_ground',
  'Convention plaza warm stone 2': 'paved_ground', 'Convention plaza warm stone 3': 'paved_ground', 'D Block recessed court paving': 'paved_ground',
  'circulation': 'paved_ground', 'West arrival warm concrete paving.001': 'paved_ground', 'Warm paving': 'paved_ground',
  'Road sidewalk stone 0': 'paved_ground', 'Road sidewalk stone 1': 'paved_ground', 'Road sidewalk stone 2': 'paved_ground',
  'Road sidewalk stone 3': 'paved_ground', 'October24 pedestrian warm stone': 'paved_ground',
  'October walkway warm stone 0': 'paved_ground', 'October walkway warm stone 1': 'paved_ground',
  'October walkway warm stone 2': 'paved_ground', 'October walkway warm stone 3': 'paved_ground',
  'Courtyard paving · pale stone with rose bands': 'paved_ground', 'Plaza slab 0': 'paved_ground', 'Plaza slab 1': 'paved_ground',
  'Plaza slab 2': 'paved_ground', 'Plaza slab 3': 'paved_ground', 'Supreme Court compound warm paving.001': 'paved_ground',
  'Main road · asphalt': 'road', 'October24 asphalt road': 'road', 'October reference warm grey road paving': 'road',
  'Supreme Court compound vehicle paving.001': 'road',
  'Pedestrian kerb contrast': 'road_marking', 'Road edge contrast': 'road_marking',
  'Gate 9 physical sign blue': 'sign', 'Gate sign lettering': 'sign',
  'West garden sculpture warm gold': 'sculpture',
};
const GROUND_CATEGORIES = new Set(['paved_ground', 'road', 'road_marking']);
/** DWG line work exported as thin ground strips (plan edges, kerb and boundary lines). */
const LINE_WORK = /^(DWG (circulation|landscape|water|planting) |Footpath and kerb lines|Road boundary lines|Actual gate linework|Planting bed edging|Final landscape layout plan)/;
const FOLIAGE = /^Detailed foliage /;

/** Hall meshes the model draws as one block. Each part goes to the hall whose footprint holds it. */
const COMBINED_HALLS: { name: RegExp; halls: string[] }[] = [
  { name: /^Halls 2-5 /, halls: ['2', '3', '4', '5'] },
  { name: /^Halls 12 and 12A /, halls: ['12', '12A'] },
];
const HALL = /^Hall (12A|\d+) /, ROOF_PART = / (roof|standing seams|roof seams|roof coping|pale roof boundary)$/;
const GATE = /^Gate ?(\d+[A-C]?)\b/i, CC = /^(Convention |CC |BHARAT MANDAPAM facade lettering$)/, FOUNTAIN = /^Fountain /;
const LIGHT_HEAD = /^(West lawn light head|Gate4 lamp head)\b/;
/** Buildings venue-site-detail.glb already draws (its SITE_northwest-office-* wings are the Supreme Court blocks
 * and D Block); that layer stays the source for them. */
export const SITE_DETAIL_DUPLICATES = /^(Supreme Court|D Block) /;
/** The model's own flat context slab under everything, hidden like OUTER_GROUND/CONTEXT_GROUND over the satellite/map. */
export const CONTEXT_GROUND = /^Ground context$/;
/** venue-site-detail.glb roads, footpaths, kerbs, walkways and markings: new ground under these is a duplicate. */
const SITE_DETAIL_ROADS = /^SITE_(ROAD_|.*lane_marking|parking_bay_marking)/;

export interface BharatMandapamPreparation {
  /** Lamp heads; the CAD lamps have no luminous material, so night lighting places its pools here. */
  lights: { kind: 'lamp'; position: Triple; name: string }[];
  /** Halls whose roofs were split from a combined block, with the number of meshes each received. */
  split: Record<string, number>;
  /** Materials the category table does not name (none for the supplied model). */
  uncategorised: string[];
  /** The campus boundary (convex hull of the fence posts), world X/Z. */
  campus: [number, number][];
}

/** GLTFLoader turns spaces in node names into underscores (and drops . : / [ ]); match on the spaced form. */
export const sourceName = (o: T.Object3D) => o.name.replace(/_/g, ' ');
const toWorld = ([s, t]: Triple) => new T.Vector2(.5 * s + .8660254038 * t, -.8660254038 * s + .5 * t);

export function prepareBharatMandapam(root: T.Group, destinations: Destination[]): BharatMandapamPreparation {
  root.updateMatrixWorld(true);
  const centres = new Map(destinations.filter(d => d.hall).map(d => [d.hall!, toWorld(d.center)]));
  const uncategorised = new Set<string>();
  const meshes: T.Mesh[] = [];
  root.traverse(o => { if (o instanceof T.Mesh) meshes.push(o); });
  for (const mesh of meshes) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const category = BHARAT_MANDAPAM_CATEGORIES[material.name];
      if (category) material.userData['architecturalCategory'] = category; else uncategorised.add(material.name);
    }
    // No material has a texture; a uniform attribute set lets one material batch into one draw.
    const material = mesh.material as T.MeshStandardMaterial;
    if (!material.map && mesh.geometry.getAttribute('uv')) mesh.geometry.deleteAttribute('uv');
  }
  const split = splitCombinedHalls(meshes, centres);
  const lights: BharatMandapamPreparation['lights'] = [];
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    const material = o.material as T.MeshStandardMaterial, category = material.userData['architecturalCategory'] as string | undefined;
    // Walkable only near grade: the planted CC ramps and terraces rise to the roof and stay solid.
    const low = new T.Box3().setFromObject(o).max.y < 1.6;
    const name = sourceName(o);
    const ground = low && (GROUND_CATEGORIES.has(category ?? '') || LINE_WORK.test(name) || (category === 'landscape' && !FOLIAGE.test(material.name)));
    if (ground) o.userData['venueRole'] = 'ground';
    // Paved walks and plazas carry the concourse crowd (venue-pedestrians.ts).
    if (ground && category === 'paved_ground' && /walkway|pedestrian|plaza|paving|pavement|slab/i.test(name) && !/road|carriageway|drive/i.test(name))
      o.userData['pedestrianSurface'] = true;
    else if (category === 'water') o.userData['venueRole'] = 'water';
    else if (FOLIAGE.test(material.name)) o.userData['venueCollider'] = 'box';
    if (SITE_DETAIL_DUPLICATES.test(name)) { o.visible = false; o.userData['supersededBySiteReference'] = true; }
    if (CONTEXT_GROUND.test(name)) o.userData['contextGround'] = true;
    if (LIGHT_HEAD.test(name)) {
      const box = new T.Box3().setFromObject(o), p = box.getCenter(new T.Vector3());
      lights.push({ kind: 'lamp', position: [p.x, box.min.y - .05, p.z], name: o.name });
    }
    const hall = o.userData['hall'] as string | undefined ?? name.match(HALL)?.[1];
    if (hall && centres.has(hall)) {
      o.userData['hall'] = hall;
      if (ROOF_PART.test(name)) o.userData['venueRole'] = / roof$/.test(name) ? 'hallRoof' : 'hallRoofPart';
      return;
    }
    if (ground) return;
    const gate = name.match(GATE)?.[1];
    if (gate) { o.userData['gate_id'] = 'gate' + gate.toLowerCase(); return; }
    if (CC.test(name)) o.userData['destinationId'] = 'cc';
    else if (FOUNTAIN.test(name)) o.userData['destinationId'] = 'fountain';
  });
  return { lights, split, uncategorised: [...uncategorised], campus: campusOutline(root) };
}

/**
 * After venue-site-detail.glb is attached. The new model is the layout inside the campus boundary; the site-detail
 * layer is the surroundings outside it (both sampled on a 1 m grid, nothing is edited on disk):
 *  - outside the boundary, the new model's ground (roads, paving, kerb and edge lines; lawns kept) under that layer's
 *    roads, footpaths, kerbs, walkways or markings is removed;
 *  - inside the boundary, that layer's roads, walkways and markings (drawn for the earlier layout) are removed.
 */
export function hideSiteDetailDuplicates(root: T.Group, site: T.Object3D, campus: [number, number][]) {
  root.updateMatrixWorld(true);
  const inside = (x: number, z: number) => insidePolygon(campus, x, z);
  const covered = new Set<number>(), key = (x: number, z: number) => (Math.floor(x) + 4096) * 8192 + Math.floor(z) + 4096;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const siteRoads: T.Mesh[] = [];
  site.traverse(o => { if (o instanceof T.Mesh && SITE_DETAIL_ROADS.test(o.name)) siteRoads.push(o); });
  for (const o of siteRoads) forEachTriangle(o, (p, q, r) => rasterise(p, q, r, (x, z) => { if (!inside(x, z)) covered.add(key(x, z)); }), a, b, c);
  const result = { newTrianglesRemoved: 0, newMeshesHidden: 0, siteTrianglesRemoved: 0, siteMeshesHidden: 0 };
  const keep = (o: T.Mesh, test: (x: number, z: number) => boolean) => {
    const index = o.geometry.index;
    if (!index) return 0;
    const kept: number[] = [];
    let t = 0;
    forEachTriangle(o, (p, q, r) => {
      if (test((p.x + q.x + r.x) / 3, (p.z + q.z + r.z) / 3)) kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
      t += 3;
    }, a, b, c);
    const removed = (index.count - kept.length) / 3;
    if (!removed) return 0;
    if (kept.length) o.geometry.setIndex(kept);
    else { o.visible = false; o.userData['supersededBySiteReference'] = true; }
    return removed;
  };
  root.traverse(o => {
    if (!(o instanceof T.Mesh) || o.userData['venueRole'] !== 'ground' || (o.material as T.Material).userData['architecturalCategory'] === 'landscape') return;
    const removed = keep(o, (x, z) => !covered.has(key(x, z)));
    result.newTrianglesRemoved += removed; if (removed && !o.visible) result.newMeshesHidden++;
  });
  for (const o of siteRoads) {
    const removed = keep(o, (x, z) => !inside(x, z));
    result.siteTrianglesRemoved += removed; if (removed && !o.visible) result.siteMeshesHidden++;
  }
  return result;
}

/** The campus: the convex hull of the boundary fence posts, in world X/Z. */
function campusOutline(root: T.Object3D): [number, number][] {
  const posts: [number, number][] = [];
  root.traverse(o => { if (o instanceof T.Mesh && /^Boundary structural post/.test(sourceName(o))) {
    const p = new T.Box3().setFromObject(o).getCenter(new T.Vector3()); posts.push([p.x, p.z]); } });
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (ps: [number, number][]) => { const h: [number, number][] = []; for (const p of ps) { while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } return h.slice(0, -1); };
  const sorted = posts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return sorted.length < 3 ? [] : [...half(sorted), ...half([...sorted].reverse())];
}
function insidePolygon(polygon: [number, number][], x: number, z: number) {
  return polygon.length >= 3 && polygon.every((a, i) => { const b = polygon[(i + 1) % polygon.length]; return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0; });
}

function forEachTriangle(mesh: T.Mesh, visit: (a: T.Vector3, b: T.Vector3, c: T.Vector3) => void, a: T.Vector3, b: T.Vector3, c: T.Vector3) {
  const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  const count = index?.count ?? position.count;
  for (let t = 0; t + 2 < count; t += 3) {
    a.fromBufferAttribute(position, index ? index.getX(t) : t).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, index ? index.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, index ? index.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
    visit(a, b, c);
  }
}

/** Every 1 m cell whose centre lies in the triangle's XZ projection, plus the cells of its corners. */
function rasterise(a: T.Vector3, b: T.Vector3, c: T.Vector3, mark: (x: number, z: number) => void) {
  for (const p of [a, b, c]) mark(p.x, p.z);
  const minX = Math.floor(Math.min(a.x, b.x, c.x)), maxX = Math.ceil(Math.max(a.x, b.x, c.x));
  const minZ = Math.floor(Math.min(a.z, b.z, c.z)), maxZ = Math.ceil(Math.max(a.z, b.z, c.z));
  const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(area) < 1e-9) return;
  for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
    const px = x + .5, pz = z + .5;
    const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / area, w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / area;
    if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mark(px, pz);
  }
}

/** Split each combined hall mesh along the bisectors between its halls' centres (a Voronoi cell per hall).
 * A triangle inside one cell is copied; a triangle across a boundary is clipped, so nothing overlaps or is lost.
 * The halls 2-5 and 12/12A blocks are continuous buildings: the cut follows the centres, not an interior wall. */
function splitCombinedHalls(meshes: T.Mesh[], centres: Map<string, T.Vector2>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { name, halls } of COMBINED_HALLS) {
    const targets = halls.filter(h => centres.has(h));
    // Half-planes n·p <= d that keep the points nearer to `hall` than to each neighbour.
    const cells = new Map(targets.map(hall => {
      const c = centres.get(hall)!;
      return [hall, targets.filter(k => k !== hall).map(k => {
        const o = centres.get(k)!;
        return { n: new T.Vector2(o.x - c.x, o.y - c.y), d: (o.lengthSq() - c.lengthSq()) / 2 };
      })];
    }));
    for (const mesh of meshes.filter(m => name.test(sourceName(m)))) {
      const parts = new Map<string, { positions: number[]; normals: number[] }>(targets.map(h => [h, { positions: [], normals: [] }]));
      const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal'), index = mesh.geometry.index;
      const normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const count = index?.count ?? position.count;
      for (let t = 0; t < count; t += 3) {
        const polygon = [0, 1, 2].map(k => {
          const i = index ? index.getX(t + k) : t + k;
          return { p: new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
            n: normal ? new T.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize() : new T.Vector3(0, 1, 0) };
        });
        for (const hall of targets) {
          let piece = polygon;
          for (const { n, d } of cells.get(hall)!) {
            piece = clipPolygon(piece, v => d - (n.x * v.p.x + n.y * v.p.z));
            if (piece.length < 3) break;
          }
          const out = parts.get(hall)!;
          for (let k = 1; k + 1 < piece.length; k++) for (const v of [piece[0], piece[k], piece[k + 1]]) {
            out.positions.push(v.p.x, v.p.y, v.p.z); out.normals.push(v.n.x, v.n.y, v.n.z);
          }
        }
      }
      const parent = mesh.parent!, toParent = parent.matrixWorld.clone().invert();
      for (const [hall, { positions, normals }] of parts) {
        if (!positions.length) continue;
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
        // Normalized Int8 normals like the rest of the model, so the pieces batch with their material.
        geometry.setAttribute('normal', new T.BufferAttribute(Int8Array.from(normals, v => Math.round(v * 127)), 3, true));
        geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const piece = new T.Mesh(geometry, mesh.material);
        piece.name = sourceName(mesh).replace(name, `Hall ${hall} `).replace(/ /g, '_');
        piece.userData = { ...mesh.userData, hall, sourceName: mesh.name };
        piece.applyMatrix4(toParent);
        parent.add(piece);
        counts[hall] = (counts[hall] ?? 0) + 1;
      }
      mesh.removeFromParent();
    }
  }
  return counts;
}

type ClipVertex = { p: T.Vector3; n: T.Vector3 };
/** Keep the part of a convex polygon where inside(v) >= 0, interpolating position and normal on cut edges. */
function clipPolygon(polygon: ClipVertex[], inside: (v: ClipVertex) => number): ClipVertex[] {
  const out: ClipVertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = inside(a), db = inside(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize() });
    }
  }
  return out;
}
