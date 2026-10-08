import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PdfPoint } from './pdf-workspace.model';

/** Only the selected, calibrated polygon and explicitly supplied height are extruded. */
@Component({
  selector: 'app-pdf-object-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host aria-label="Selected object 3D preview"></div>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    <p>
      Drag to orbit. Geometry preview using the height you supplied; materials and construction
      details are unknown.
    </p>`,
  styles: `
    :host {
      display: block;
      margin: 16px 0;
    }
    div {
      height: 220px;
      background: var(--surface-sidebar);
      border: 1px solid var(--border-subtle);
    }
    p {
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-secondary);
    }
  `,
})
export class PdfObjectPreviewComponent {
  readonly points = input.required<PdfPoint[]>();
  readonly height = input.required<number>();
  readonly error = signal('');
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly ready = signal(false);
  private cleanup?: () => void;
  constructor() {
    afterNextRender(() => this.ready.set(true));
    effect(() => {
      const points = this.points(),
        height = this.height();
      if (this.ready()) this.draw(points, height);
    });
    inject(DestroyRef).onDestroy(() => this.cleanup?.());
  }
  private draw(points: PdfPoint[], height: number): void {
    this.cleanup?.();
    this.cleanup = undefined;
    const host = this.host().nativeElement;
    host.replaceChildren();
    this.error.set('');
    if (points.length < 3 || !Number.isFinite(height) || height <= 0) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      this.error.set(
        '3D preview is unavailable in this browser. The calibrated 2D geometry is retained.',
      );
      return;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f8fafc');
    const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!,
      centre = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    geometry.translate(-centre.x, 0, -centre.z);
    const material = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const edges = new THREE.EdgesGeometry(geometry),
      lineMaterial = new THREE.LineBasicMaterial({ color: 0x1e293b });
    scene.add(new THREE.LineSegments(edges, lineMaterial));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(1, 3, 2);
    scene.add(light);
    const span = Math.max(size.x, size.z, height, 0.01),
      camera = new THREE.PerspectiveCamera(40, 1, span / 1000, span * 100);
    camera.position.set(span * 1.8, height / 2 + span * 1.4, span * 1.8);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, height / 2, 0);
    controls.enablePan = false;
    controls.update();
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = new ResizeObserver(() => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(host);
    this.cleanup = () => {
      resize.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      edges.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }
}
