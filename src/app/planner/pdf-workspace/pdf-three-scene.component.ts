import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PdfDrawingSurface } from '../three/pdf-drawing-surface';
import {
  calibrationFor,
  type PageInspection,
  type PdfObject,
  type PdfPoint,
  type PdfWorkspace,
  type SourcePath,
} from './pdf-workspace.model';

export type PdfTileRenderer = (
  canvas: HTMLCanvasElement,
  scale: number,
  left: number,
  top: number,
  width: number,
  height: number,
) => Promise<void>;
const VIEW_NOTE =
  'Full-page overview follows PDF proportions. Calibrate each hall for measurements; objects without a confirmed scale and height stay flat.';

/** The scene uses page coordinates. Physical height is converted through each object's reviewed scale. */
@Component({
  selector: 'app-pdf-three-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scene-tools" role="group" aria-label="Three.js camera">
      <strong>Three.js</strong>
      <button type="button" [attr.aria-pressed]="cameraMode() === 'top'" (click)="setCamera('top')">
        Top view
      </button>
      <button
        type="button"
        [attr.aria-pressed]="cameraMode() === 'orbit'"
        (click)="setCamera('orbit')"
      >
        3D orbit
      </button>
      <span>{{
        cameraMode() === 'top'
          ? 'Drag to pan · scroll to zoom'
          : 'Drag to orbit · right-drag to pan'
      }}</span>
    </div>
    <div
      #host
      class="scene-host"
      [hidden]="!!surface()"
      aria-label="Interactive Three.js PDF plan"
    ></div>
    <p class="scene-note" role="status">{{ status() }}</p>
    @if (failed()) {
      <button type="button" (click)="fallback.emit()">Open 2D reference instead</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 280px;
      min-width: 0;
      background: #e6eaf0;
    }
    .scene-tools {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px 12px;
      background: var(--surface-card);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      color: var(--text-secondary);
    }
    .scene-tools strong {
      color: var(--text-primary);
    }
    button {
      font: inherit;
      padding: 7px 10px;
      min-height: 34px;
      border: 1px solid var(--border-default);
      border-radius: 6px;
      background: var(--surface-card);
      color: var(--text-primary);
      cursor: pointer;
    }
    button[aria-pressed='true'] {
      background: #e8efff;
      color: #153e8a;
      border-color: #779de4;
    }
    button:hover {
      background: #e8efff;
    }
    button:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .scene-host {
      position: relative;
      flex: 1;
      min-height: 200px;
      overflow: hidden;
    }
    .scene-host[hidden] {
      display: none;
    }
    :host:has(.scene-host[hidden]) {
      min-height: 0;
      flex: none;
    }
    .scene-note {
      flex: none;
      margin: 0;
      padding: 8px 12px;
      color: #334155;
      font-size: 12px;
      line-height: 1.4;
    }
    @media (max-width: 760px) {
      :host {
        flex: none;
      }
      .scene-host {
        flex: none;
        height: min(45dvh, 420px);
      }
    }
  `,
})
export class PdfThreeSceneComponent {
  readonly surface = input<PdfDrawingSurface | null>(null);
  readonly page = input.required<PageInspection>();
  readonly document = input.required<PdfWorkspace>();
  readonly renderTile = input.required<PdfTileRenderer>();
  readonly objects = input<readonly PdfObject[]>([]);
  readonly selectedId = input('');
  readonly selectedPath = input<SourcePath | null>(null);
  readonly points = input<readonly PdfPoint[]>([]);
  readonly tool = input('select');
  readonly view = input('compare');
  readonly busy = input(false);
  readonly picked = output<{ point: PdfPoint; tolerance: number }>();
  readonly selected = output<string>();
  readonly zoomChanged = output<number>();
  readonly fallback = output<void>();
  readonly cameraMode = signal<'top' | 'orbit'>('top');
  readonly status = signal('Loading the complete PDF drawing…');
  readonly failed = signal(false);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly ready = signal(false);
  private readonly zone = inject(NgZone);
  private scene = new THREE.Scene();
  private readonly sourceGroup = new THREE.Group();
  private readonly objectGroup = new THREE.Group();
  private readonly draftGroup = new THREE.Group();
  private camera!: THREE.OrthographicCamera;
  private renderer?: THREE.WebGLRenderer;
  private controls?: OrbitControls;
  private resize?: ResizeObserver;
  private detail?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private timer?: ReturnType<typeof setTimeout>;
  private pageKey = '';
  private generation = 0;
  private tileGeneration = 0;
  private disposed = false;
  private sourceReady = false;
  private down?: { x: number; y: number; id: number };
  private activePointers = new Set<number>();
  private moved = false;

  constructor() {
    afterNextRender(() => this.initialize());
    effect(() => {
      const page = this.page(),
        doc = this.document(),
        busy = this.busy();
      if (!this.ready() || busy) return;
      const key = `${doc.id}:${doc.sha256}:${page.page}`;
      if (key !== this.pageKey) untracked(() => void this.loadPage(key));
    });
    effect(() => {
      this.objects();
      this.document();
      this.selectedId();
      this.selectedPath();
      this.points();
      this.view();
      this.page();
      if (this.ready()) untracked(() => this.syncObjects());
    });
    effect(() => {
      this.view();
      if (this.ready()) untracked(() => this.scheduleDetail());
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  private initialize(): void {
    try {
      const surface = this.surface();
      this.renderer = surface?.renderer ?? new THREE.WebGLRenderer({ antialias: true });
      if (surface) this.scene = surface.scene;
      else {
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.scene.background = new THREE.Color('#e6eaf0');
      }
      this.scene.add(this.sourceGroup, this.objectGroup, this.draftGroup);
      if (!surface) {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2));
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(1, 3, 2);
        this.scene.add(light);
      }
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
      surface?.useCamera(this.camera);
      const canvas = this.renderer.domElement;
      if (!surface) {
        canvas.setAttribute('aria-label', 'Three.js PDF drawing');
        canvas.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
        this.host().nativeElement.append(canvas);
      }
      this.zone.runOutsideAngular(() => {
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = false;
        this.controls.screenSpacePanning = false;
        this.controls.minZoom = 0.25;
        this.controls.maxZoom = 64;
        this.controls.maxPolarAngle = Math.PI * 0.43;
        this.controls.addEventListener('change', this.onCameraChanged);
        canvas.addEventListener('pointerdown', this.onDown);
        canvas.addEventListener('pointermove', this.onMove);
        canvas.addEventListener('pointerup', this.onUp);
        canvas.addEventListener('pointercancel', this.onCancel);
        this.resize = new ResizeObserver(() => this.resizeScene());
        this.resize.observe(surface?.host ?? this.host().nativeElement);
      });
      this.ready.set(true);
      this.fit();
    } catch {
      this.failed.set(true);
      this.status.set(
        'Three.js is unavailable in this browser. Your PDF and geometry are retained; use the 2D reference.',
      );
    }
  }

  private async loadPage(key: string): Promise<void> {
    this.pageKey = key;
    const generation = ++this.generation;
    ++this.tileGeneration;
    clearTimeout(this.timer);
    this.sourceReady = false;
    this.failed.set(false);
    clearGroup(this.sourceGroup);
    this.detail = undefined;
    this.status.set('Rendering the complete PDF in Three.js…');
    this.fit();
    this.syncObjects();
    try {
      const page = this.page(),
        canvas = document.createElement('canvas');
      const scale = this.textureScale(page.width, page.height);
      await this.renderTile()(canvas, scale, 0, 0, page.width * scale, page.height * scale);
      if (this.disposed || generation !== this.generation) return;
      const plane = this.texturePlane(canvas, 0, 0, page.width, page.height, 0);
      plane.name = 'original-pdf-page';
      this.sourceGroup.add(plane);
      this.sourceReady = true;
      this.status.set(VIEW_NOTE);
      this.render();
      this.scheduleDetail();
    } catch (e) {
      if (generation !== this.generation || this.disposed) return;
      this.failed.set(true);
      this.status.set(e instanceof Error ? e.message : 'Could not render the PDF.');
    }
  }

  private textureScale(width: number, height: number): number {
    const maximum = Math.min(2048, this.renderer?.capabilities.maxTextureSize ?? 2048);
    return (maximum - 1) / Math.max(width, height) / Math.min(devicePixelRatio || 1, 2);
  }
  private texturePlane(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number,
    elevation: number,
  ): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const page = this.page(),
      texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x + width / 2 - page.width / 2, elevation, y + height / 2 - page.height / 2);
    return plane;
  }

  fit(): void {
    if (!this.renderer || !this.controls) return;
    const page = this.page(),
      span = Math.max(page.width, page.height);
    this.controls.target.set(0, 0, 0);
    this.camera.zoom = 1;
    this.camera.position.set(0, span * 2, this.cameraMode() === 'top' ? 0.000001 : span * 1.4);
    this.camera.far = span * 30;
    this.configureControls();
    this.resizeScene();
    this.controls.update();
    this.zone.run(() => this.zoomChanged.emit(1));
  }
  setCamera(mode: 'top' | 'orbit'): void {
    this.cameraMode.set(mode);
    this.fit();
  }
  zoom(factor: number): void {
    if (!this.controls) return;
    this.camera.zoom = Math.min(64, Math.max(0.25, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
    this.onCameraChanged();
  }
  private configureControls(): void {
    if (!this.controls) return;
    const top = this.cameraMode() === 'top';
    this.controls.enableRotate = !top;
    this.controls.mouseButtons.LEFT = top ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = top ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }
  private resizeScene(): void {
    if (!this.renderer) return;
    const host = this.surface()?.host ?? this.host().nativeElement,
      width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    const aspect = width / height,
      page = this.page(),
      half = Math.max(page.height, page.width / aspect) * 0.56;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
    this.scheduleDetail();
  }
  private onCameraChanged = (): void => {
    this.render();
    this.scheduleDetail();
    this.zone.run(() => this.zoomChanged.emit(this.camera.zoom));
  };
  private render(): void {
    if (!this.renderer || this.disposed) return;
    this.sourceGroup.visible = this.view() !== 'edited';
    this.objectGroup.visible = this.view() !== 'original';
    this.draftGroup.visible = this.view() !== 'original';
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  private scheduleDetail(): void {
    clearTimeout(this.timer);
    if (!this.sourceReady || this.busy() || this.view() === 'edited') return;
    ++this.tileGeneration;
    this.timer = setTimeout(() => void this.renderDetail(), 180);
  }
  private async renderDetail(): Promise<void> {
    if (!this.renderer || this.disposed || !this.sourceReady || this.busy()) return;
    const corners = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]
      .map(([x, y]) => this.floorPoint(x, y))
      .filter((p): p is PdfPoint => !!p);
    if (corners.length !== 4) return;
    const page = this.page();
    const x = Math.max(0, Math.min(...corners.map((p) => p.x))),
      y = Math.max(0, Math.min(...corners.map((p) => p.y)));
    const right = Math.min(page.width, Math.max(...corners.map((p) => p.x))),
      bottom = Math.min(page.height, Math.max(...corners.map((p) => p.y)));
    const width = right - x,
      height = bottom - y;
    if (width <= 0 || height <= 0 || (width >= page.width * 0.9 && height >= page.height * 0.9))
      return;
    const generation = this.generation,
      tile = ++this.tileGeneration;
    try {
      const canvas = document.createElement('canvas'),
        scale = this.textureScale(width, height);
      await this.renderTile()(canvas, scale, x * scale, y * scale, width * scale, height * scale);
      if (this.disposed || generation !== this.generation || tile !== this.tileGeneration) return;
      if (this.detail) {
        this.sourceGroup.remove(this.detail);
        disposeMesh(this.detail);
      }
      this.detail = this.texturePlane(canvas, x, y, width, height, 0.005);
      this.detail.name = 'pdf-zoom-detail';
      this.sourceGroup.add(this.detail);
      this.status.set(VIEW_NOTE);
      this.render();
    } catch (e) {
      if (!this.disposed && generation === this.generation && tile === this.tileGeneration)
        this.status.set(
          `Zoom detail could not be refreshed; the overview remains visible. ${e instanceof Error ? e.message : ''}`,
        );
    }
  }

  private syncObjects(): void {
    clearGroup(this.objectGroup);
    clearGroup(this.draftGroup);
    const page = this.page(),
      doc = this.document();
    for (const object of this.objects()) {
      const shape = new THREE.Shape(
        object.points.map((p) => new THREE.Vector2(p.x - page.width / 2, -(p.y - page.height / 2))),
      );
      const scale = calibrationFor(doc, object)?.metresPerUnit;
      const depth = object.heightMetres && scale ? object.heightMetres / scale : 0;
      const extruded = Number.isFinite(depth) && depth > 0;
      const geometry = extruded
        ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
        : new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      const selected = object.id === this.selectedId(),
        color = selected ? 0x2563eb : object.reviewed ? 0x087f5b : 0x64748b;
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: extruded ? 0.38 : selected ? 0.2 : 0.06,
          side: THREE.DoubleSide,
          depthWrite: !!extruded,
        }),
      );
      mesh.position.y = 0.025;
      mesh.userData['objectId'] = object.id;
      mesh.name = extruded ? 'confirmed-height-object' : 'flat-pdf-object';
      this.objectGroup.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color }),
      );
      edges.position.y = 0.03;
      this.objectGroup.add(edges);
      if (selected && this.view() === 'compare')
        this.line(object.sourcePoints, 0x64748b, true, true);
    }
    const path = this.selectedPath();
    if (path) {
      if (path.curved || path.compound || path.clipped) {
        const b = path.bounds;
        this.line(
          [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
            { x: b.x, y: b.y + b.height },
          ],
          0xb45309,
          true,
          true,
        );
      } else this.line(path.points, 0xb45309, path.closed);
    }
    if (this.points().length) {
      this.line(this.points(), 0x2563eb, false);
      const geometry = new THREE.BufferGeometry().setFromPoints(
        this.points().map(
          (p) => new THREE.Vector3(p.x - page.width / 2, 0.06, p.y - page.height / 2),
        ),
      );
      this.draftGroup.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: 0x1d4ed8,
            size: 7,
            sizeAttenuation: false,
            depthTest: false,
          }),
        ),
      );
    }
    this.render();
  }
  private line(points: readonly PdfPoint[], color: number, closed: boolean, dashed = false): void {
    if (points.length < 2) return;
    const page = this.page(),
      vertices = points.map(
        (p) => new THREE.Vector3(p.x - page.width / 2, 0.05, p.y - page.height / 2),
      );
    if (closed) vertices.push(vertices[0].clone());
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const material = dashed
      ? new THREE.LineDashedMaterial({
          color,
          dashSize: Math.max(page.width, page.height) / 250,
          gapSize: Math.max(page.width, page.height) / 500,
        })
      : new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.draftGroup.add(line);
  }
  private floorPoint(x: number, y: number): PdfPoint | null {
    const ray = new THREE.Raycaster();
    this.camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const point = ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
    return point
      ? { x: point.x + this.page().width / 2, y: point.z + this.page().height / 2 }
      : null;
  }
  private onDown = (e: PointerEvent): void => {
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.moved = true;
      return;
    }
    if (e.button === 0) {
      this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.moved = false;
    }
  };
  private onMove = (e: PointerEvent): void => {
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4)
      this.moved = true;
  };
  private onCancel = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    this.down = undefined;
    this.moved = true;
  };
  private onUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);
    if (!this.down || this.down.id !== e.pointerId) return;
    this.down = undefined;
    if (
      this.moved ||
      this.busy() ||
      !this.sourceReady ||
      this.view() === 'original' ||
      !this.renderer
    )
      return;
    const b = this.renderer.domElement.getBoundingClientRect(),
      x = (2 * (e.clientX - b.left)) / b.width - 1,
      y = 1 - (2 * (e.clientY - b.top)) / b.height;
    if (this.tool() === 'select') {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
      const hit = ray
        .intersectObjects(this.objectGroup.children)
        .find((h) => h.object.userData['objectId']);
      if (hit) {
        this.zone.run(() => this.selected.emit(hit.object.userData['objectId']));
        return;
      }
    }
    const point = this.floorPoint(x, y);
    if (point) {
      const tolerance = (5 * (this.camera.right - this.camera.left)) / this.camera.zoom / b.width;
      this.zone.run(() => this.picked.emit({ point, tolerance }));
    }
  };
  private dispose(): void {
    this.disposed = true;
    ++this.generation;
    ++this.tileGeneration;
    clearTimeout(this.timer);
    this.resize?.disconnect();
    this.controls?.dispose();
    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener('pointerdown', this.onDown);
    canvas?.removeEventListener('pointermove', this.onMove);
    canvas?.removeEventListener('pointerup', this.onUp);
    canvas?.removeEventListener('pointercancel', this.onCancel);
    clearGroup(this.sourceGroup);
    clearGroup(this.objectGroup);
    clearGroup(this.draftGroup);
    this.scene.remove(this.sourceGroup, this.objectGroup, this.draftGroup);
    if (this.surface()) this.surface()!.useCamera(null);
    else {
      this.renderer?.dispose();
      canvas?.remove();
    }
  }
}
function disposeMesh(mesh: THREE.Object3D): void {
  const object = mesh as THREE.Mesh;
  object.geometry?.dispose();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    (material as THREE.MeshBasicMaterial | undefined)?.map?.dispose();
    material?.dispose();
  }
}
function clearGroup(group: THREE.Group): void {
  group.traverse(disposeMesh);
  group.clear();
}
