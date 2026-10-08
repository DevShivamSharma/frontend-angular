import * as THREE from 'three';
import type { PdfFloorPlan } from '../pdf-workspace/pdf-hall-plan';
import { pointInPolygon } from '../geometry/placement-rules';
import { makeTextSprite } from './text-sprite';

/** A clean semantic floor view; source annotations remain in the optional PDF layer. */
export function buildPdfFloorPlan(plan: PdfFloorPlan, showLabels: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pdf-floor-plan';
  for (const region of plan.regions) {
    const foyer = region.kind === 'foyer';
    const shape = new THREE.Shape(region.boundary.map(p => new THREE.Vector2(p.x, -p.z)));
    const geometry = new THREE.ShapeGeometry(shape);
    const floor = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: foyer ? '#d1e4f4' : '#f1f5f9', roughness: 0.85, side: THREE.DoubleSide,
    }));
    floor.name = `pdf-floor-${region.id}`;
    floor.userData = { objectId: region.id, kind: region.kind, name: region.name };
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);
    if (!showLabels) continue;
    const edge = new THREE.BufferGeometry().setFromPoints(region.boundary.map(p => new THREE.Vector3(p.x, .015, p.z)));
    const outline = new THREE.LineLoop(edge, new THREE.LineBasicMaterial({ color: foyer ? '#6588a8' : '#64748b' }));
    outline.name = `pdf-outline-${region.id}`;
    group.add(outline);
    const xs = region.boundary.map(p => p.x), zs = region.boundary.map(p => p.z);
    const width = Math.max(...xs) - Math.min(...xs), length = Math.max(...zs) - Math.min(...zs);
    let centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    // A concave floor's bounding-box centre may lie outside it. Use an interior triangle then.
    if (!pointInPolygon(centre, region.boundary) && geometry.index) {
      const positions = geometry.getAttribute('position');
      let largest = -1;
      for (let i = 0; i < geometry.index.count; i += 3) {
        const tri = [0, 1, 2].map(j => geometry.index!.getX(i + j));
        const [a, b, c] = tri.map(j => ({ x: positions.getX(j), z: -positions.getY(j) }));
        const area = Math.abs((b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x));
        if (area > largest) { largest = area; centre = { x: (a.x+b.x+c.x)/3, z: (a.z+b.z+c.z)/3 }; }
      }
    }
    const label = makeTextSprite([region.name], { color: foyer ? '#214c70' : '#334155', lineHeight: foyer ? 1.35 : 1.8 });
    const fit = Math.min(1, width * .85 / label.scale.x, length * .65 / label.scale.y);
    label.scale.multiplyScalar(fit);
    label.name = `pdf-label-${region.id}`;
    label.position.set(centre.x, .06, centre.z);
    group.add(label);
  }
  return group;
}
