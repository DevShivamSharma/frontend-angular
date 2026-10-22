import * as T from 'three';

/** Which labels win when they would overlap: halls and the CC, then gates, then the rest (the ITPO app's order). */
export const LABEL_RANK: Record<string, number> = { halls: 1, conventionCentre: 1, gates: 2, amphitheatres: 3, parking: 3 };
/** A label's box below its pin point (venue-map.css .pin-label: top 4px, ~23px tall), with a little air around it. */
const LABEL_TOP = 4, LABEL_HEIGHT = 23, LABEL_GAP = 3;

/** Keep the map's DOM place pins over their world points, using frames the viewer already renders.
 * Each pin carries data-x, data-y and data-z in world metres; the layer belongs to the venue map.
 * Labels that would overlap a more important one are hidden (`label-hidden`) and show on hover or focus.
 */
export function createVenueMapPins(
  layer: HTMLElement, camera: T.PerspectiveCamera, canvas: HTMLCanvasElement,
  invalidate: () => void, signal: AbortSignal
) {
  const point = new T.Vector3();
  // Label widths change only with the text; measured once each, never per frame.
  const widths = new WeakMap<Element, number>();
  layer.hidden = true;
  // Pins arrive after the place list loads, maybe while the scene is idle: draw a frame to place them.
  const observer = new MutationObserver(invalidate);
  observer.observe(layer, { childList: true });
  signal.addEventListener('abort', () => { observer.disconnect(); layer.hidden = true; }, { once: true });

  return (visible: boolean): void => {
    layer.hidden = !visible;
    if (!visible) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const shown: { pin: HTMLElement; x: number; y: number; depth: number; rank: number }[] = [];
    for (const pin of layer.querySelectorAll<HTMLElement>('[data-x]')) {
      point.set(+pin.dataset['x']!, +pin.dataset['y']!, +pin.dataset['z']!).project(camera);
      const onScreen = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.02 && Math.abs(point.y) < 1.02;
      pin.classList.toggle('on-screen', onScreen);
      if (!onScreen) continue;
      const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
      pin.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      if (!pin.hidden) shown.push({ pin, x, y, depth: point.z, rank: LABEL_RANK[pin.dataset['group'] ?? ''] ?? 9 });
    }
    // Most important first, then nearest the camera; a label goes only where it clears those already placed.
    shown.sort((a, b) => a.rank - b.rank || a.depth - b.depth);
    const placed: [number, number, number, number][] = [];
    for (const { pin, x, y } of shown) {
      const label = pin.querySelector('.pin-label');
      if (!label) continue;
      let w = widths.get(label);
      if (!w) { w = (label as HTMLElement).offsetWidth; if (w) widths.set(label, w); }
      const box: [number, number, number, number] = [x - w / 2 - LABEL_GAP, y + LABEL_TOP - LABEL_GAP, x + w / 2 + LABEL_GAP, y + LABEL_TOP + LABEL_HEIGHT + LABEL_GAP];
      const clash = placed.some(([l, t, r, b]) => box[0] < r && l < box[2] && box[1] < b && t < box[3]);
      pin.classList.toggle('label-hidden', clash);
      if (!clash) placed.push(box);
    }
  };
}
