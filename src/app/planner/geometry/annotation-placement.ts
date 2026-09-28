import { Point, Rect, pointInPolygon, rectOverlapsPolygon } from './placement-rules';

/** Visual clearance in plan metres, independent of stall placement rules. */
export const ANNOTATION_GAP = 1;

export interface AnnotationCard {
  anchor: Point;
  width: number;
  height: number;
}

export function annotationRect(card: AnnotationCard, gap = 0): Rect {
  return {
    minX: card.anchor.x - gap,
    maxX: card.anchor.x + card.width + gap,
    minZ: card.anchor.z - gap,
    maxZ: card.anchor.z + card.height + gap,
  };
}

/**
 * Clear perimeter cards from the floor, gate labels and neighbouring cards. Source anchors are
 * never edited: only their display positions move. Cards deliberately anchored inside the hall
 * (for example circulation arrows) keep their relationship to the interior.
 *
 * Try the nearest horizontal/vertical shift past obstacle edges. This keeps a perimeter row
 * aligned with its gate instead of packing unrelated facilities together in a separate legend.
 */
export function placeAnnotationCards<T extends AnnotationCard>(
  cards: readonly T[],
  floors: Point[][],
  reserved: readonly Rect[] = [],
): T[] {
  const originals = cards.map((card) => annotationRect(card));
  const placed: Rect[] = [];
  return cards.map((card, index) => {
    const obstacles = [...reserved, ...placed, ...originals.slice(index + 1)];
    const perimeter = !floors.some((floor) => pointInPolygon(card.anchor, floor));
    const relevantFloors = perimeter ? floors : [];
    const clear = (anchor: Point): boolean => {
      const rect = annotationRect({ ...card, anchor }, ANNOTATION_GAP);
      return (
        !obstacles.some((obstacle) => rectanglesOverlap(rect, obstacle)) &&
        !relevantFloors.some((floor) => rectOverlapsPolygon(rect, floor))
      );
    };

    let anchor = { ...card.anchor };
    if (!clear(anchor)) {
      const xs = new Set<number>();
      const zs = new Set<number>();
      for (const floor of relevantFloors) {
        for (const point of floor) {
          xs.add(point.x);
          zs.add(point.z);
        }
      }
      for (const obstacle of obstacles) {
        xs.add(obstacle.minX).add(obstacle.maxX);
        zs.add(obstacle.minZ).add(obstacle.maxZ);
      }
      const candidates: Point[] = [];
      for (const x of xs) {
        candidates.push(
          { x: x - ANNOTATION_GAP - card.width, z: anchor.z },
          { x: x + ANNOTATION_GAP, z: anchor.z },
        );
      }
      for (const z of zs) {
        candidates.push(
          { x: anchor.x, z: z - ANNOTATION_GAP - card.height },
          { x: anchor.x, z: z + ANNOTATION_GAP },
        );
      }
      const distance = (p: Point): number => (p.x - anchor.x) ** 2 + (p.z - anchor.z) ** 2;
      candidates.sort((a, b) => distance(a) - distance(b));
      anchor = candidates.find(clear) ?? anchor;
    }
    const result = { ...card, anchor };
    placed.push(annotationRect(result));
    return result;
  });
}

function rectanglesOverlap(a: Rect, b: Rect): boolean {
  const epsilon = 1e-6;
  return a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon &&
    a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon;
}
