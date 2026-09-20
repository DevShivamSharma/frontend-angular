import * as THREE from 'three';

import { BlockedArea, Hall } from '../models/hall.model';

/** Matches `scene.background` in scene3d.component.ts so masks erase the floor visually. */
const OUTSIDE_MASK_COLOR = '#dbe5ef';
const WALL_FALLBACK_COLOR = '#742371';
const WALL_HEIGHT = 1.5;

/**
 * Builds the irregular-hall geometry group: outside masks, boundary walls and
 * zone overlays from `hall.blockedAreas`.
 *
 * - `outside` masks are flat planes in the scene-background colour at y = 0.14
 *   with `depthTest: false` and a high renderOrder: they paint over the floor
 *   and the grid, carving the irregular outline.
 * - `wall` rectangles become solid boxes (height 1.5) that cast shadows.
 * - `zone` rectangles are flat, slightly transparent planes in their own colour
 *   at y = 0.125, just under the grid lines. Visual only.
 *
 * A hall without `blockedAreas` yields an empty group.
 */
export function buildBlockedAreas(hall: Hall): THREE.Group {
  const group = new THREE.Group();

  for (const area of hall.blockedAreas ?? []) {
    if (!isFiniteArea(area)) continue;

    if (area.kind === 'wall') {
      group.add(buildWall(area));
    } else if (area.kind === 'outside') {
      group.add(buildOutsideMask(area));
    } else {
      group.add(buildZone(area));
    }
  }

  return group;
}

function buildOutsideMask(area: BlockedArea): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(area.width, area.length),
    new THREE.MeshBasicMaterial({ color: OUTSIDE_MASK_COLOR, depthTest: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(area.posX, 0.14, area.posZ);
  mesh.renderOrder = 10;
  return mesh;
}

function buildWall(area: BlockedArea): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(area.width, WALL_HEIGHT, area.length),
    new THREE.MeshStandardMaterial({ color: area.color || WALL_FALLBACK_COLOR, roughness: 0.85 })
  );
  mesh.position.set(area.posX, WALL_HEIGHT / 2, area.posZ);
  mesh.castShadow = true;
  return mesh;
}

function buildZone(area: BlockedArea): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(area.width, area.length),
    new THREE.MeshBasicMaterial({ color: area.color, transparent: true, opacity: 0.9 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(area.posX, 0.125, area.posZ);
  return mesh;
}

function isFiniteArea(area: BlockedArea): boolean {
  return (
    Number.isFinite(area.posX) &&
    Number.isFinite(area.posZ) &&
    Number.isFinite(area.width) &&
    Number.isFinite(area.length) &&
    area.width > 0 &&
    area.length > 0
  );
}
