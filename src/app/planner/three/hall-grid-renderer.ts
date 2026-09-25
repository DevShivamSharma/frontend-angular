import * as THREE from 'three';

import { GridSystem } from '../geometry/grid-system';
import { Point } from '../geometry/placement-rules';
import { HallShape } from '../models/hall.model';

/**
 * Builds the floor grid group. Ported from the React `HallGrid` component
 * (App.js:367-455).
 *
 * Explicit line geometry is used instead of a helper grid so the lines stay
 * visible above the hall floor - that is why every material has
 * `depthTest: false`, exactly as in React.
 *
 * Lines come from the hall's GridSystem, so they start at the hall corner and every drawn line
 * is a real snap line. With a boundary polygon each line is clipped to the polygon, so the grid
 * exists only inside the hall.
 */
export function buildHallGrid(
  width: number,
  length: number,
  shape: HallShape,
  grid?: GridSystem,
  boundary?: Point[] | null
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hall-grid';
  group.position.set(0, 0.13, 0);

  const w = Math.max(1, Number(width) || 40);
  const l = Math.max(1, Number(length) || 40);
  const system = grid ?? new GridSystem(-w / 2, -l / 2, w, l);
  const polygon = boundary && boundary.length >= 3 ? boundary : null;
  const { minX, minZ, maxX, maxZ } = system.bounds;
  const cell = system.cellSize;
  const cols = Math.round(system.width / cell);
  const rows = Math.round(system.length / cell);

  const unitVertices: number[] = [];
  const sectionVertices: number[] = [];

  for (let c = 0; c <= cols; c++) {
    const x = minX + c * cell;
    const target = c % 5 === 0 ? sectionVertices : unitVertices;
    for (const [z1, z2] of polygon ? clipVertical(polygon, x) : [[minZ, maxZ]]) {
      pushLine(target, x, z1, x, z2);
    }
  }
  for (let r = 0; r <= rows; r++) {
    const z = minZ + r * cell;
    const target = r % 5 === 0 ? sectionVertices : unitVertices;
    for (const [x1, x2] of polygon ? clipHorizontal(polygon, z) : [[minX, maxX]]) {
      pushLine(target, x1, z, x2, z);
    }
  }

  // 1 x 1 cell grid.
  group.add(
    lineSegments(
      unitVertices,
      new THREE.LineBasicMaterial({
        color: '#64748b',
        transparent: true,
        opacity: 0.62,
        depthTest: false
      })
    )
  );

  // Stronger section lines every 5 cells.
  group.add(
    lineSegments(
      sectionVertices,
      new THREE.LineBasicMaterial({
        color: '#1e293b',
        transparent: true,
        opacity: 0.9,
        depthTest: false
      })
    )
  );

  // Hall border: the polygon outline, or the rectangle.
  const outline = polygon ?? [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ }
  ];
  const borderVertices: number[] = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    pushLine(borderVertices, p.x, p.z, q.x, q.z);
  });
  group.add(lineSegments(borderVertices, new THREE.LineBasicMaterial({ color: '#0f172a', depthTest: false })));

  if (shape === 'SQUARE' && !polygon) {
    // Centre axis markers. These are NOT rotated flat in the React source, so
    // they render as two thin upright blades through the hall centre. Ported
    // as-is for visual parity; see the migration notes.
    const axisMaterial = new THREE.MeshBasicMaterial({ color: '#0284c7', depthTest: false });

    const axisZ = new THREE.Mesh(new THREE.PlaneGeometry(0.035, l), axisMaterial);
    axisZ.position.set(0, 0.001, 0);
    group.add(axisZ);

    const axisX = new THREE.Mesh(new THREE.PlaneGeometry(0.035, w), axisMaterial);
    axisX.position.set(0, 0.001, 0);
    axisX.rotation.set(0, Math.PI / 2, 0);
    group.add(axisX);
  }

  return group;
}

/**
 * The parts of the vertical line x = const that lie inside the polygon, as [z1, z2] pairs.
 * Even-odd crossings with the half-open rule (an edge counts when x is in [min, max) of its
 * endpoints), so lines through vertices and along vertical walls are handled consistently.
 */
export function clipVertical(polygon: Point[], x: number): Array<[number, number]> {
  const hits: number[] = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if ((a.x <= x) !== (b.x <= x)) {
      hits.push(a.z + ((x - a.x) * (b.z - a.z)) / (b.x - a.x));
    }
  });
  return pairs(hits);
}

/** The parts of the horizontal line z = const inside the polygon, as [x1, x2] pairs. */
export function clipHorizontal(polygon: Point[], z: number): Array<[number, number]> {
  const hits: number[] = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if ((a.z <= z) !== (b.z <= z)) {
      hits.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
    }
  });
  return pairs(hits);
}

function pairs(hits: number[]): Array<[number, number]> {
  hits.sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    if (hits[i + 1] - hits[i] > 1e-9) out.push([hits[i], hits[i + 1]]);
  }
  return out;
}

function pushLine(target: number[], x1: number, z1: number, x2: number, z2: number): void {
  target.push(x1, 0, z1, x2, 0, z2);
}

function lineSegments(vertices: number[], material: THREE.Material): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, material);
}
