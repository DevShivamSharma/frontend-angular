import * as T from 'three';
import type { SurroundingBuilding } from './venue-surroundings';
import { Point, SURROUNDINGS_GRADE, insideSurroundings, surroundingsBox, surroundingsShape, paintSurroundings } from './venue-surroundings-geometry';

/** Inferred façade detail sits on the real OSM envelope; it never alters the hall model. */
export function buildSurroundingBuildings(buildings: SurroundingBuilding[]) {
  const volumes: T.BufferGeometry[] = [], detail: T.BufferGeometry[] = [], windows: T.BufferGeometry[] = [];
  let windowCount = 0;
  const add = (bin: T.BufferGeometry[], geometry: T.BufferGeometry, colour: string, wall = colour) => bin.push(paintSurroundings(geometry, colour, wall));
  const signedArea = (p: Point[]) => p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  for (const building of buildings) {
    const b = building, outline = surroundingsShape(b.p, b.holes);
    const extrude = (height: number, base: number) => {
      const geometry = new T.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 });
      geometry.rotateX(-Math.PI / 2); geometry.translate(0, SURROUNDINGS_GRADE + base, 0); return geometry;
    };
    if (b.station) {
      // The mapped station outline remains open underneath: platform, columns and a curved metal canopy.
      add(volumes, extrude(.85, b.base - .85), '#aaa99f');
      let longest = 0, axis = new T.Vector2(1, 0);
      for (let i = 0; i < b.p.length; i++) {
        const a = b.p[i], c = b.p[(i + 1) % b.p.length], dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
        if (length > longest) { longest = length; axis.set(dx / length, dz / length); }
      }
      const across = (p: Point) => -axis.y * p[0] + axis.x * p[1];
      const low = Math.min(...b.p.map(across)), high = Math.max(...b.p.map(across));
      const along = b.p.map(p => axis.x * p[0] + axis.y * p[1]);
      for (let u = Math.min(...along) + 12; u < Math.max(...along) - 6; u += 24) {
        for (const v of [low + (high - low) * .3, low + (high - low) * .7]) {
          const p: Point = [axis.x * u - axis.y * v, axis.y * u + axis.x * v];
          if (!insideSurroundings(p, b.p)) continue;
          const pier = new T.BoxGeometry(1.3, b.base - .85, 1.3);
          pier.rotateY(-Math.atan2(axis.y, axis.x));
          pier.translate(p[0], SURROUNDINGS_GRADE + (b.base - .85) / 2, p[1]); add(volumes, pier, '#aaa99e');
        }
      }
      const rise = Math.min(2.6, (b.h - b.base) * .5), eave = b.h - rise;
      const height = (p: Point) => eave + rise * Math.sqrt(Math.max(0, 1 - ((across(p) - (low + high) / 2) / ((high - low) / 2)) ** 2));
      const cap = new T.ShapeGeometry(outline), flat = cap.toNonIndexed(), position = flat.getAttribute('position');
      cap.dispose();
      const vertices: number[] = [];
      const midpoint = (a: Point, c: Point): Point => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const vertex = (p: Point, offset = 0) => [p[0], SURROUNDINGS_GRADE + height(p) + offset, p[1]];
      function triangle(a: Point, c: Point, d: Point, divisions: number) {
        if (divisions) {
          const ac = midpoint(a, c), cd = midpoint(c, d), da = midpoint(d, a);
          triangle(a, ac, da, divisions - 1); triangle(ac, c, cd, divisions - 1);
          triangle(da, cd, d, divisions - 1); triangle(ac, cd, da, divisions - 1);
        } else vertices.push(...vertex(a), ...vertex(c), ...vertex(d), ...vertex(d, -.18), ...vertex(c, -.18), ...vertex(a, -.18));
      }
      for (let i = 0; i < position.count; i += 3) triangle([position.getX(i), -position.getY(i)],
        [position.getX(i + 1), -position.getY(i + 1)], [position.getX(i + 2), -position.getY(i + 2)], 3);
      flat.dispose();
      const roof = new T.BufferGeometry(); roof.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); roof.computeVertexNormals();
      add(volumes, roof, b.roof);
      for (let i = 0; i < b.p.length; i++) {
        const a = b.p[i], c = b.p[(i + 1) % b.p.length], dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
        if (length < .5) continue;
        add(detail, surroundingsBox(a, c, .18, .8, b.base), '#a5aaa5');
        for (let d = 2; d < length; d += 10) {
          const p: Point = [a[0] + dx * d / length, a[1] + dz * d / length];
          const column = new T.BoxGeometry(.42, eave - b.base, .42);
          column.translate(p[0], SURROUNDINGS_GRADE + (eave + b.base) / 2, p[1]); add(volumes, column, '#bbc0ba');
        }
      }
      continue;
    }
    add(volumes, extrude(b.h - b.base, b.base), b.roof, b.wall);
    const centre: Point = [b.p.reduce((s, p) => s + p[0], 0) / b.p.length, b.p.reduce((s, p) => s + p[1], 0) / b.p.length];
    const floors = Math.max(1, Math.min(12, b.floors ?? Math.round((b.h - b.base) / 3.7)));
    const storey = (b.h - b.base) / floors;
    for (const [ringIndex, ring] of [b.p, ...(b.holes ?? [])].entries()) {
      const outward = (signedArea(ring) > 0 ? 1 : -1) * (ringIndex ? -1 : 1);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
        if (length < .4) continue;
        // Real roof-edge thickness and courtyard parapets make silhouettes read from oblique views.
        add(detail, surroundingsBox(a, c, .32, .58, b.h), b.wall);
        if (Math.hypot(...centre) > 1450 || length < 4 || b.h - b.base < 5) continue;
        const nx = dz / length * outward, nz = -dx / length * outward;
        for (let floor = 1; floor < floors; floor++)
          add(detail, surroundingsBox(a, c, .24, .13, b.base + floor * storey), b.wall);
        const count = Math.max(1, Math.floor((length - 1.6) / 3.8));
        for (let floor = 0; floor < floors && windowCount < 9000; floor++) for (let j = 0; j < count && windowCount < 9000; j++) {
          const d = (j + .5) * length / count, x = a[0] + dx * d / length + nx * .035, z = a[1] + dz * d / length + nz * .035;
          const width = Math.min(1.6, length / count * .48), height = Math.min(1.65, storey * .47);
          const y = b.base + floor * storey + storey * .47;
          const window = new T.PlaneGeometry(width, height); window.rotateY(Math.atan2(nx, nz));
          window.translate(x, SURROUNDINGS_GRADE + y + height / 2, z); add(windows, window, '#4b6064'); windowCount++;
          const half = width / 2 + .12;
          const left: Point = [x - dx / length * half, z - dz / length * half], right: Point = [x + dx / length * half, z + dz / length * half];
          add(detail, surroundingsBox(left, right, .24, .09, y - .08), b.wall);
        }
      }
    }
  }
  return { volumes, detail, windows };
}
