import * as THREE from 'three';

import { HallShape } from '../models/hall.model';

/**
 * Builds the floor grid group. Ported from the React `HallGrid` component
 * (App.js:367-455).
 *
 * Explicit line geometry is used instead of a helper grid so the lines stay
 * visible above the hall floor - that is why every material has
 * `depthTest: false`, exactly as in React.
 */
export function buildHallGrid(width: number, length: number, shape: HallShape): THREE.Group {
  const group = new THREE.Group();
  group.position.set(0, 0.13, 0);

  const w = Math.max(1, Number(width) || 40);
  const l = Math.max(1, Number(length) || 40);
  const halfW = w / 2;
  const halfL = l / 2;

  // 1 x 1 unit grid.
  const unitVertices: number[] = [];
  for (let x = Math.ceil(-halfW); x <= Math.floor(halfW); x += 1) {
    pushLine(unitVertices, x, -halfL, x, halfL);
  }
  for (let z = Math.ceil(-halfL); z <= Math.floor(halfL); z += 1) {
    pushLine(unitVertices, -halfW, z, halfW, z);
  }
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

  // Stronger 5 x 5 unit section lines.
  const sectionVertices: number[] = [];
  for (let x = Math.ceil(-halfW / 5) * 5; x <= halfW; x += 5) {
    pushLine(sectionVertices, x, -halfL, x, halfL);
  }
  for (let z = Math.ceil(-halfL / 5) * 5; z <= halfL; z += 5) {
    pushLine(sectionVertices, -halfW, z, halfW, z);
  }
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

  // Hall border.
  group.add(
    lineSegments(
      [
        -halfW, 0, -halfL, halfW, 0, -halfL,
        halfW, 0, -halfL, halfW, 0, halfL,
        halfW, 0, halfL, -halfW, 0, halfL,
        -halfW, 0, halfL, -halfW, 0, -halfL
      ],
      new THREE.LineBasicMaterial({ color: '#0f172a', depthTest: false })
    )
  );

  if (shape === 'SQUARE') {
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

function pushLine(target: number[], x1: number, z1: number, x2: number, z2: number): void {
  target.push(x1, 0, z1, x2, 0, z2);
}

function lineSegments(vertices: number[], material: THREE.Material): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, material);
}
