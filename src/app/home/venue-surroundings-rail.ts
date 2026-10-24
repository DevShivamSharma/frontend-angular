import * as T from 'three';
import type { SurroundingRailway } from './venue-surroundings';
import { Point, SURROUNDINGS_GRADE, paintSurroundings, surroundingsBox, surroundingsRibbon } from './venue-surroundings-geometry';

/** Raised ballast, steel rails and concrete metro structures follow the registered OSM tracks. */
export function buildSurroundingRailways(railways: SurroundingRailway[]) {
  const beds: T.BufferGeometry[] = [], structures: T.BufferGeometry[] = [], detail: T.BufferGeometry[] = [];
  const add = (bin: T.BufferGeometry[], geometry: T.BufferGeometry, colour: string, wall = colour) => bin.push(paintSurroundings(geometry, colour, wall));
  let sleepers = 0;
  for (const rail of railways) {
    const y = rail.y + (rail.metro ? .22 : .5);
    add(beds, surroundingsRibbon(rail.p, rail.w, 0, y, rail.metro ? .9 : .5, rail.metro ? .12 : .8),
      rail.metro ? '#999b94' : '#756b59', rail.metro ? '#8b8e85' : '#5c5345');
    for (const offset of [-rail.gauge / 2, rail.gauge / 2])
      add(beds, surroundingsRibbon(rail.p, .13, offset, y + .24, .13), '#a2a6a4', '#555b59');
    if (rail.metro) for (const offset of [-rail.w / 2, rail.w / 2])
      add(structures, surroundingsRibbon(rail.p, .24, offset, y + .8, .8), '#b1b2a8');
    let sleeperAt = 0, pierAt = 12, traversed = 0;
    for (let i = 1; i < rail.p.length; i++) {
      const a = rail.p[i - 1], b = rail.p[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < .1) continue;
      const at = (d: number): Point => [a[0] + dx * d / length, a[1] + dz * d / length];
      while (sleeperAt < traversed + length && sleepers < 6000) {
        const p = at(sleeperAt - traversed), half = rail.gauge * .78;
        const left: Point = [p[0] - dz / length * half, p[1] + dx / length * half];
        const right: Point = [p[0] + dz / length * half, p[1] - dx / length * half];
        add(detail, surroundingsBox(left, right, .28, .13, y + .01), '#a49a85');
        sleeperAt += 3; sleepers++;
      }
      if (rail.y > 0) while (pierAt < traversed + length) {
        const p = at(pierAt - traversed), height = Math.max(.1, y - (rail.metro ? .9 : .5));
        const pier = new T.BoxGeometry(1.45, height, 1.45);
        pier.translate(p[0], SURROUNDINGS_GRADE + height / 2, p[1]); add(structures, pier, '#aaa99e');
        const left: Point = [p[0] - dz / length * rail.w / 2, p[1] + dx / length * rail.w / 2];
        const right: Point = [p[0] + dz / length * rail.w / 2, p[1] - dx / length * rail.w / 2];
        add(structures, surroundingsBox(left, right, 1.8, .6, height - .6), '#aaa99e');
        pierAt += 32;
      }
      traversed += length;
    }
  }
  return { beds, structures, detail };
}
