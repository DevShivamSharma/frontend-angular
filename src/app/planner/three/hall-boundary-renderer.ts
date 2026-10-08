import * as THREE from 'three';

import { forEachEdge, Point, pointInPolygon } from '../geometry/placement-rules';

const FLOOR_COLOR = '#f1f5f9';
/** The purple boundary of the SelfCare reference layout (source data colour #742371). */
const WALL_COLOR = '#742371';
const WALL_HEIGHT = 1.5;
/** Wall thickness of the source data (0.5 m wall rectangles). Drawn outside the floor polygon. */
const WALL_THICKNESS = 0.5;

/**
 * The hall itself when it has a real outline: a floor shaped exactly like the boundary polygon
 * (THREE.Shape -> ShapeGeometry) and one wall box along every edge.
 *
 * This replaces the rectangle-plus-white-masks approach for such halls: nothing outside the
 * polygon is ever drawn, so there is no rectangle to hide. Walls sit OUTSIDE the polygon, so the
 * polygon stays the usable floor that validation measures against.
 */
export function buildHallBoundary(boundary: Point[], drawWalls = true): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hall-boundary';

  // Shape space is X/Y; the mesh is laid flat with rotation.x = -PI/2, which maps
  // shape (x, y) to world (x, 0, -y). Hence y = -z here.
  const shape = new THREE.Shape(boundary.map(p => new THREE.Vector2(p.x, -p.z)));
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.78 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'hall-floor';
  group.add(floor);

  if (drawWalls) {
    const wallMaterial = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.85 });
    forEachEdge(boundary, (a, b) => group.add(buildWall(a, b, boundary, wallMaterial)));
  }

  return group;
}

function buildWall(a: Point, b: Point, boundary: Point[], material: THREE.Material): THREE.Mesh {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);

  // Outward normal: of the two perpendiculars, the one whose side of the edge is outside.
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  let nx = -dz / length;
  let nz = dx / length;
  if (pointInPolygon({ x: mid.x + nx * 0.01, z: mid.z + nz * 0.01 }, boundary)) {
    nx = -nx;
    nz = -nz;
  }

  // Extended by one thickness so neighbouring walls close the corners.
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS),
    material
  );
  mesh.position.set(
    mid.x + (nx * WALL_THICKNESS) / 2,
    WALL_HEIGHT / 2,
    mid.z + (nz * WALL_THICKNESS) / 2
  );
  // Rotating the box's X axis by -angle about Y aligns it with the edge direction (dx, dz).
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  return mesh;
}
