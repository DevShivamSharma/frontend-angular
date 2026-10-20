import * as T from 'three';

/** Keep the map's DOM place pins over their world points, using frames the viewer already renders.
 * Each pin carries data-x, data-y and data-z in world metres; the layer belongs to the venue map.
 */
export function createVenueMapPins(
  layer: HTMLElement, camera: T.PerspectiveCamera, canvas: HTMLCanvasElement,
  invalidate: () => void, signal: AbortSignal
) {
  const point = new T.Vector3();
  layer.hidden = true;
  // Pins arrive after the place list loads, maybe while the scene is idle: draw a frame to place them.
  const observer = new MutationObserver(invalidate);
  observer.observe(layer, { childList: true });
  signal.addEventListener('abort', () => { observer.disconnect(); layer.hidden = true; }, { once: true });

  return (visible: boolean): void => {
    layer.hidden = !visible;
    if (!visible) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    for (const pin of layer.querySelectorAll<HTMLElement>('[data-x]')) {
      point.set(+pin.dataset['x']!, +pin.dataset['y']!, +pin.dataset['z']!).project(camera);
      const onScreen = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.02 && Math.abs(point.y) < 1.02;
      pin.classList.toggle('on-screen', onScreen);
      if (onScreen) pin.style.transform = `translate(${((point.x + 1) * width / 2).toFixed(1)}px,${((1 - point.y) * height / 2).toFixed(1)}px)`;
    }
  };
}
