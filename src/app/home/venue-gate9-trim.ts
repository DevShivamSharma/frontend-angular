import * as T from 'three';

type Vertex = { local: T.Vector2; values: number[][] };
type Plane = (p: T.Vector2) => number;

/** Remove only superseded pieces inside the photographed entrance footprint.
 * Clipping (rather than whole-object hiding) preserves the rest of the perimeter
 * wall and the shared tree meshes used across the venue.
 */
export function trimGate9Context(root: T.Group, added: T.Group): void {
  const gateRegion: Plane[] = [
    p => (p.x + 542.692) * .447213596 + (p.y + 363.315) * .894427191 + 24,
    p => 24 - (p.x + 542.692) * .447213596 - (p.y + 363.315) * .894427191,
    p => (p.x + 542.692) * .894427191 - (p.y + 363.315) * .447213596 + 95,
    p => 32 - (p.x + 542.692) * .894427191 + (p.y + 363.315) * .447213596,
  ];
  const insideRegion: Plane[] = [p => p.x + 527, p => -363 - p.x, p => p.y + 428, p => -381 - p.y];
  function clip(poly: Vertex[], plane: Plane, sign: number): Vertex[] {
    const result: Vertex[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = plane(a.local) * sign, db = plane(b.local) * sign;
      if (da >= 0) result.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        result.push({ local: a.local.clone().lerp(b.local, t),
          values: a.values.map((v, j) => v.map((n, k) => T.MathUtils.lerp(n, b.values[j][k], t))) });
      }
    }
    return result;
  }
  function subtract(poly: Vertex[], planes: Plane[]): Vertex[][] {
    if (planes.some(plane => poly.every(p => plane(p.local) < 0))) return [poly];
    const outside: Vertex[][] = [];
    let remainder = poly;
    for (const plane of planes) {
      const part = clip(remainder, plane, -1);
      if (part.length >= 3) outside.push(part);
      remainder = clip(remainder, plane, 1);
      if (remainder.length < 3) break;
    }
    return outside;
  }
  root.updateMatrixWorld(true);
  const retired = new Set<T.BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    let names = '';
    for (let node: T.Object3D | null = object; node; node = node.parent) {
      if (node === added || !node.visible) return;
      names += ' ' + node.name;
    }
    const boundary = /BOUNDARY_WALL/.test(names);
    if (!boundary && !/leaf.canop|tree|branches|crown/i.test(names)) return;
    const geometry = object.geometry;
    const attributes = Object.entries(geometry.attributes) as [string, T.BufferAttribute][];
    const positionIndex = attributes.findIndex(([name]) => name === 'position');
    if (positionIndex < 0) return;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld);
    const corners = [new T.Vector2(.5 * box.min.x - .8660254038 * box.min.z, .8660254038 * box.min.x + .5 * box.min.z),
      new T.Vector2(.5 * box.max.x - .8660254038 * box.min.z, .8660254038 * box.max.x + .5 * box.min.z),
      new T.Vector2(.5 * box.min.x - .8660254038 * box.max.z, .8660254038 * box.min.x + .5 * box.max.z),
      new T.Vector2(.5 * box.max.x - .8660254038 * box.max.z, .8660254038 * box.max.x + .5 * box.max.z)];
    const misses = (planes: Plane[]) => planes.some(plane => corners.every(p => plane(p) < 0));
    if (misses(gateRegion) && (boundary || misses(insideRegion))) return;
    const position = attributes[positionIndex][1], index = geometry.index;
    const output: number[][] = attributes.map(() => []);
    const next = new T.BufferGeometry();
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
    for (const group of groups) {
      const start = output[positionIndex].length / 3;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const poly = [0, 1, 2].map(offset => {
          const vertex = index ? index.getX(i + offset) : i + offset;
          const world = new T.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld);
          return { local: new T.Vector2(.5 * world.x - .8660254038 * world.z, .8660254038 * world.x + .5 * world.z),
            values: attributes.map(([, attribute]) => Array.from({ length: attribute.itemSize }, (_, component) => attribute.getComponent(vertex, component))) };
        });
        let pieces = subtract(poly, gateRegion);
        if (!boundary) pieces = pieces.flatMap(piece => subtract(piece, insideRegion));
        for (const piece of pieces) for (let j = 1; j < piece.length - 1; j++)
          for (const vertex of [piece[0], piece[j], piece[j + 1]]) vertex.values.forEach((values, k) => output[k].push(...values));
      }
      next.addGroup(start, output[positionIndex].length / 3 - start, group.materialIndex);
    }
    attributes.forEach(([name, attribute], i) => next.setAttribute(name, new T.Float32BufferAttribute(output[i], attribute.itemSize)));
    next.computeBoundingBox(); next.computeBoundingSphere();
    object.geometry = next;
    retired.add(geometry);
  });
  root.traverse(object => { if (object instanceof T.Mesh) retired.delete(object.geometry); });
  retired.forEach(geometry => geometry.dispose());
}
