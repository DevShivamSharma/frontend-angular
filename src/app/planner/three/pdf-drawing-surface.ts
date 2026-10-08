import type * as THREE from 'three';

/** Borrow the planner's existing renderer and scene; the planner retains their lifetime. */
export interface PdfDrawingSurface {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  host: HTMLElement;
  useCamera(camera: THREE.OrthographicCamera | null): void;
}
