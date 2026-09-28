import * as T from 'three';

/** Project an accessible DOM button onto Delhi without adding a second render loop. */
export function createVenueGlobeMarker(
  element: HTMLElement, camera: T.PerspectiveCamera, canvas: HTMLCanvasElement,
  center: T.Vector3, radius: number, signal: AbortSignal
) {
  const destination = new T.Vector3(0, 38000, 0);
  const projected = new T.Vector3(), direction = new T.Vector3(), intersection = new T.Vector3();
  const ray = new T.Ray(), earth = new T.Sphere(center, radius);
  let lastX = NaN, lastY = NaN;
  element.hidden = true;
  signal.addEventListener('abort', () => { element.hidden = true; }, { once: true });

  return (available: boolean): void => {
    if (!available || signal.aborted) { element.hidden = true; return; }
    camera.updateMatrixWorld();
    projected.copy(destination).project(camera);
    direction.subVectors(destination, camera.position);
    const distance = direction.length();
    ray.set(camera.position, direction.normalize());
    const hit = ray.intersectSphere(earth, intersection);
    const occluded = hit !== null && camera.position.distanceTo(hit) < distance - 1;
    const visible = !occluded && projected.z >= -1 && projected.z <= 1
      && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
    element.hidden = !visible;
    if (!visible) return;

    const width = canvas.clientWidth, height = canvas.clientHeight;
    const x = (projected.x + 1) * width / 2;
    const y = (1 - projected.y) * height / 2;
    // Keep the button and its tooltip on screen; the pointer still marks the exact location.
    const left = Math.round(Math.max(88, Math.min(width - 88, x)));
    const top = Math.round(y);
    if (left !== lastX) { element.style.left = `${left}px`; lastX = left; }
    if (top !== lastY) { element.style.top = `${top}px`; lastY = top; }
    element.style.setProperty('--marker-pointer-offset', `${Math.round(x - left)}px`);
    element.classList.toggle('is-below', y < 112);
  };
}
