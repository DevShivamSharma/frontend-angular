import * as THREE from 'three';

import { FloorRegion, Point } from '../geometry/placement-rules';
import { BlockedArea } from '../models/hall.model';

const FLOOR_COLOR = '#f8fafc';
const WALL_FALLBACK_COLOR = '#742371';
const WALL_HEIGHT = 1.5;

/** userData key carrying a hover tooltip (the source plan's `title`, e.g. "Pillar"). */
export const UD_TOOLTIP = 'planTooltip';

/**
 * The floor of a hall traced from its plan: one flat shape per region, holes cut out.
 *
 * Replaces "one W x L rectangle, then paint the outside over it". Every region is real geometry,
 * so a foyer below the main floor, or floor past the plan's breadth, is drawn like the rest.
 */
export function buildFloorRegions(regions: FloorRegion[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hall-floor';
  const material = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.78 });

  for (const region of regions) {
    // Shape space is X/Y; the mesh is laid flat with rotation.x = -PI/2, which maps shape (x, y)
    // to world (x, 0, -y). Hence y = -z.
    const shape = new THREE.Shape(region.outer.map((p) => new THREE.Vector2(p.x, -p.z)));
    for (const hole of region.holes) {
      shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.z))));
    }
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * The plan's own rectangles, as SelfCare draws them:
 * - walls (#742371) as solid boxes;
 * - every other coloured rectangle (pillars, curtains, passage markers...) as a flat patch in its
 *   fill colour with its stroke colour around it, carrying its `title` as a hover tooltip;
 * - outside masks are not drawn: the traced floor already leaves those parts empty;
 * - hidden rectangles (`visibleInView: false`) are not drawn. They still block placement.
 */
export function buildPlanAreas(
  areas: readonly BlockedArea[],
  options: { drawOutside: boolean },
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'plan-areas';

  for (const area of areas) {
    if (area.hidden || !isFiniteArea(area)) continue;
    if (area.kind === 'wall') group.add(buildWall(area));
    else if (area.kind === 'outside') {
      if (options.drawOutside) group.add(buildOutsideMask(area));
    } else group.add(buildPatch(area));
  }
  return group;
}

function buildWall(area: BlockedArea): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(area.width, WALL_HEIGHT, area.length),
    new THREE.MeshStandardMaterial({ color: area.color || WALL_FALLBACK_COLOR, roughness: 0.85 }),
  );
  mesh.position.set(area.posX, WALL_HEIGHT / 2, area.posZ);
  mesh.castShadow = true;
  if (area.title) mesh.userData[UD_TOOLTIP] = area.title;
  return mesh;
}

/**
 * Only for a hall with no traced floor (its rectangle floor is drawn whole): masks in the scene
 * background colour, drawn over floor and grid.
 */
function buildOutsideMask(area: BlockedArea): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(area.width, area.length),
    new THREE.MeshBasicMaterial({ color: '#e6eaf0', depthTest: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(area.posX, 0.14, area.posZ);
  mesh.renderOrder = 10;
  return mesh;
}

function buildPatch(area: BlockedArea): THREE.Group {
  const group = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(area.width, area.length),
    new THREE.MeshBasicMaterial({ color: area.color || '#94a3b8', toneMapped: false }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(area.posX, 0.16, area.posZ);
  fill.renderOrder = 12;
  if (area.title) fill.userData[UD_TOOLTIP] = area.title;
  group.add(fill);

  if (area.strokeColor && area.strokeColor !== area.color) {
    const hw = area.width / 2;
    const hl = area.length / 2;
    const corners: Point[] = [
      { x: area.posX - hw, z: area.posZ - hl },
      { x: area.posX + hw, z: area.posZ - hl },
      { x: area.posX + hw, z: area.posZ + hl },
      { x: area.posX - hw, z: area.posZ + hl },
    ];
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        corners.map((p) => new THREE.Vector3(p.x, 0.17, p.z)),
      ),
      new THREE.LineBasicMaterial({ color: area.strokeColor, toneMapped: false }),
    );
    line.renderOrder = 13;
    group.add(line);
  }
  return group;
}

function isFiniteArea(area: BlockedArea): boolean {
  return (
    [area.posX, area.posZ, area.width, area.length].every(Number.isFinite) &&
    area.width > 0 &&
    area.length > 0
  );
}
