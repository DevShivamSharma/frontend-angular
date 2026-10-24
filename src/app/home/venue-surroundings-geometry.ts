import * as T from 'three';

export type Point = [number, number];
// The existing groundGroup raises its children by 6.6 m; the outside grade is -.3 m.
export const SURROUNDINGS_GRADE = -6.9;

export function insideSurroundings(point: Point, ring: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) &&
      point[0] < (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  return hit;
}

export function surroundingsShape(p: Point[], holes: Point[][] = []) {
  const result = new T.Shape(p.map(([x, z]) => new T.Vector2(x, -z)));
  for (const hole of holes) result.holes.push(new T.Path(hole.map(([x, z]) => new T.Vector2(x, -z))));
  return result;
}

/** Shared position/normal/colour layout lets every static concern merge into a handful of materials. */
export function paintSurroundings(geometry: T.BufferGeometry, roof: string, wall = roof) {
  if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
  geometry.deleteAttribute('uv');
  const normals = geometry.getAttribute('normal'), colours = new Float32Array(normals.count * 3);
  const top = new T.Color(roof), side = new T.Color(wall);
  for (let i = 0; i < normals.count; i++) {
    const colour = normals.getY(i) > .5 ? top : side;
    colours.set([colour.r, colour.g, colour.b], i * 3);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
  return geometry;
}

export function surroundingsBox(a: Point, b: Point, width: number, height: number, y: number) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const geometry = new T.BoxGeometry(width, height, Math.hypot(dx, dz));
  geometry.rotateY(Math.atan2(dx, dz));
  geometry.translate((a[0] + b[0]) / 2, SURROUNDINGS_GRADE + y + height / 2, (a[1] + b[1]) / 2);
  return geometry;
}

/** A joined strip, optionally with sloping banks. Every cross-section follows the OSM centreline. */
export function surroundingsRibbon(p: Point[], width: number, offset: number, y: number, depth = 0, shoulder = 0) {
  const sections = p.map((point, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
    const next = p[i === p.length - 1 ? i - 1 : i + 1], sx = next[0] - point[0], sz = next[1] - point[1];
    const stretch = Math.min(1.6, 1 / Math.max(.01, Math.abs((dx * sx + dz * sz) / length / (Math.hypot(sx, sz) || 1))));
    const at = (across: number, height: number) => [point[0] + dz / length * across * stretch,
      SURROUNDINGS_GRADE + height, point[1] - dx / length * across * stretch];
    return [at(offset - width / 2, y), at(offset + width / 2, y),
      at(offset - width / 2 - shoulder, y - depth), at(offset + width / 2 + shoulder, y - depth)];
  });
  const vertices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i];
    quad(a[0], b[0], a[1], b[1]);
    if (depth) { quad(a[2], b[2], a[0], b[0]); quad(a[1], b[1], a[3], b[3]); }
  }
  if (depth) {
    const a = sections[0], b = sections.at(-1)!;
    quad(a[0], a[1], a[2], a[3]); quad(b[1], b[0], b[3], b[2]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
  return geometry;
}
