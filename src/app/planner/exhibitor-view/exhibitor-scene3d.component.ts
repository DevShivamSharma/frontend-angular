import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  output,
  untracked,
  viewChild
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { floorOutlines, planSize } from '../geometry/hall-plan';
import type { Rect, HallOpening } from '../geometry/placement-rules';
import type { Hall, HallMarker, HallAmenity } from '../models/hall.model';
import { planFrame, type ExhibitorStall } from './exhibitor-view';

/**
 * Read-only 3D view of a saved layout for exhibitors: an isometric hall with
 * elevated walls, floor grid, availability-coloured stalls (green = available,
 * orange = booked), floating labels, entrance/exit markers, and OrbitControls
 * for orbit/zoom/pan. Click selects a stall.
 */
@Component({
  selector: 'app-exhibitor-scene3d',
  templateUrl: './exhibitor-scene3d.component.html',
  styleUrl: './exhibitor-scene3d.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExhibitorScene3dComponent implements AfterViewInit {
  readonly hall = input.required<Hall>();
  readonly stalls = input.required<readonly ExhibitorStall[]>();
  readonly selectedId = input<string | null>(null);
  /** Stalls matching the list's search and filters; the rest are dimmed. null: nothing filtered. */
  readonly matches = input<ReadonlySet<string> | null>(null);
  /** Bring a stall into view (e.g. picked from the list). `seq` repeats a request for the same stall. */
  readonly focus = input<{ id: string; seq: number } | null>(null);

  readonly select = output<string | null>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly overlay = viewChild.required<ElementRef<HTMLDivElement>>('overlay');

  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private resizeObserver?: ResizeObserver;
  private frameId = 0;
  private ready = false;

  private readonly hallGroup = new THREE.Group();
  private readonly stallGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private readonly stallEntries = new Map<string, StallEntry>();
  private framedHallId: string | null = null;

  private pressStart: { x: number; y: number } | null = null;
  private pressDragged = false;

  constructor() {
    effect(() => {
      const hall = this.hall();
      if (!this.ready) return;
      this.rebuildHall(hall);
    });

    effect(() => {
      const stalls = this.stalls();
      const selected = this.selectedId();
      const matches = this.matches();
      if (!this.ready) return;
      this.rebuildStalls(stalls, selected, matches);
    });

    effect(() => {
      const request = this.focus();
      if (!this.ready || !request) return;
      const stall = untracked(this.stalls).find(s => s.id === request.id);
      if (stall) this.focusStall(stall);
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  ngAfterViewInit(): void {
    const host = this.host().nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef2f7');
    this.scene.fog = new THREE.Fog('#eef2f7', 120, 320);
    this.scene.add(this.hallGroup, this.stallGroup, this.markerGroup);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    this.camera.position.set(0, 40, 45);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.styleCanvas(this.renderer.domElement);
    host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const directional = new THREE.DirectionalLight(0xffffff, 1.5);
    directional.position.set(25, 50, 20);
    directional.castShadow = true;
    directional.shadow.camera.left = -80;
    directional.shadow.camera.right = 80;
    directional.shadow.camera.top = 80;
    directional.shadow.camera.bottom = -80;
    directional.shadow.mapSize.set(1024, 1024);
    this.scene.add(directional);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 0.4);
    this.scene.add(hemi);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 300;
    this.controls.maxPolarAngle = Math.PI / 2.1;

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.ready = true;
    this.resize();
    this.rebuildHall(this.hall());
    this.rebuildStalls(this.stalls(), this.selectedId(), this.matches());

    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
      this.animate();
    });
  }

  // --- hall --------------------------------------------------------------------------------------

  private rebuildHall(hall: Hall): void {
    disposeChildren(this.hallGroup);
    disposeChildren(this.markerGroup);
    disposeLabels(this.markerGroup, this.overlay().nativeElement);

    this.hallGroup.add(buildFloor(hall));
    this.hallGroup.add(buildBoundaryWalls(hall));

    for (const opening of hall.openings ?? []) {
      const node = buildOpening(opening, this.overlay().nativeElement);
      if (node) this.markerGroup.add(node);
    }
    for (const marker of hall.markers ?? []) {
      const node = buildMarker(marker, this.overlay().nativeElement);
      if (node) this.markerGroup.add(node);
    }
    for (const amenity of hall.amenities ?? []) {
      const node = buildAmenity(amenity, this.overlay().nativeElement);
      if (node) this.markerGroup.add(node);
    }

    if (this.framedHallId !== String(hall.id)) {
      this.framedHallId = String(hall.id);
      this.frameAll(hall);
    }
  }

  private frameAll(hall: Hall): void {
    const frame = planFrame(hall, this.stalls());
    this.focusRect(frame, 0.9);
  }

  private focusRect(rect: Rect, fill: number): void {
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const width = Math.max(rect.maxX - rect.minX, 6);
    const depth = Math.max(rect.maxZ - rect.minZ, 6);
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const dH = width / (2 * Math.tan(hHalf) * fill);
    const dV = depth / (2 * Math.tan(vHalf) * fill);
    const distance = Math.max(dH, dV);

    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, distance * 0.72, cz + distance * 0.68);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 1.5);
    this.camera.far = Math.max(this.camera.far, this.controls.maxDistance + Math.max(width, depth) + 50);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private focusStall(stall: ExhibitorStall): void {
    const b = stall.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 4);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const distance = Math.max(span * 4, 16);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, distance * 0.72, cz + distance * 0.68);
    this.controls.update();
  }

  // --- stalls ------------------------------------------------------------------------------------

  private rebuildStalls(
    stalls: readonly ExhibitorStall[],
    selectedId: string | null,
    matches: ReadonlySet<string> | null
  ): void {
    const seen = new Set<string>();
    const overlay = this.overlay().nativeElement;

    for (const stall of stalls) {
      seen.add(stall.id);
      let entry = this.stallEntries.get(stall.id);
      if (!entry) {
        entry = new StallEntry(stall, overlay);
        this.stallEntries.set(stall.id, entry);
        this.stallGroup.add(entry.group);
      }
      const dimmed = !!matches && !matches.has(stall.id) && stall.id !== selectedId;
      entry.update(stall, stall.id === selectedId, dimmed);
    }

    for (const [id, entry] of this.stallEntries) {
      if (!seen.has(id)) {
        entry.dispose();
        this.stallEntries.delete(id);
      }
    }
  }

  // --- pointer -----------------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pressStart = { x: event.clientX, y: event.clientY };
    this.pressDragged = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.pressStart) {
      this.updateHoverCursor(event);
      return;
    }
    if (!this.pressDragged && Math.hypot(event.clientX - this.pressStart.x, event.clientY - this.pressStart.y) > 6) {
      this.pressDragged = true;
    }
  };

  private readonly onPointerUp = (): void => {
    this.pressStart = null;
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (this.pressDragged) {
      this.pressDragged = false;
      return;
    }
    const id = this.pickStallId(event);
    this.select.emit(id);
  };

  private readonly onPointerLeave = (): void => {
    this.renderer.domElement.style.cursor = 'default';
  };

  private updateHoverCursor(event: PointerEvent): void {
    this.renderer.domElement.style.cursor = this.pickStallId(event) ? 'pointer' : 'default';
  }

  private pickStallId(event: PointerEvent | MouseEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.stallGroup.children, true);
    if (!hits.length) return null;
    let node: THREE.Object3D | null = hits[0].object;
    while (node && node.userData['stallId'] === undefined) node = node.parent;
    return node ? String(node.userData['stallId']) : null;
  }

  // --- render loop -------------------------------------------------------------------------------

  private readonly animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls.update();
    const { clientWidth, clientHeight } = this.host().nativeElement;
    this.renderer.render(this.scene, this.camera);
    for (const entry of this.stallEntries.values()) {
      entry.projectLabel(this.camera, clientWidth, clientHeight);
    }
    for (const child of this.markerGroup.children) {
      const projector = child.userData['projectLabel'] as ((cam: THREE.PerspectiveCamera, w: number, h: number) => void) | undefined;
      projector?.(this.camera, clientWidth, clientHeight);
    }
  };

  private styleCanvas(canvas: HTMLCanvasElement): void {
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
  }

  private resize(): void {
    const host = this.host().nativeElement;
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private teardown(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    if (!this.ready) return;
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);

    this.stallEntries.forEach(e => e.dispose());
    this.stallEntries.clear();
    disposeChildren(this.hallGroup);
    disposeChildren(this.stallGroup);
    disposeChildren(this.markerGroup);
    disposeLabels(this.markerGroup, this.overlay().nativeElement);
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

// --- Stall entry ---------------------------------------------------------------------------------

class StallEntry {
  readonly group = new THREE.Group();
  private readonly label: HTMLDivElement;
  private signature = '';
  private selected = false;
  private dimmed = false;
  private readonly anchor = new THREE.Object3D();
  private topY = 1.2;

  constructor(private stall: ExhibitorStall, private readonly overlay: HTMLElement) {
    this.group.userData['stallId'] = stall.id;
    this.group.add(this.anchor);
    this.label = document.createElement('div');
    this.label.className = 'xv3-stall-label';
    this.overlay.appendChild(this.label);
  }

  update(stall: ExhibitorStall, selected: boolean, dimmed: boolean): void {
    this.stall = stall;
    const sig = [
      stall.id,
      stall.available ? 'A' : 'B',
      selected ? 'S' : '-',
      dimmed ? 'D' : '-',
      stall.outline.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';')
    ].join('|');

    if (sig !== this.signature) {
      this.signature = sig;
      this.selected = selected;
      this.dimmed = dimmed;
      this.rebuild();
    } else {
      this.selected = selected;
      this.dimmed = dimmed;
    }

    const number = stall.stall.stallNumber || stall.name;
    const status = stall.available ? 'Available' : 'Booked';
    this.label.innerHTML = `<b>${escape(number)}</b><span>${status}</span>`;
    this.label.classList.toggle('is-available', stall.available);
    this.label.classList.toggle('is-booked', !stall.available);
    this.label.classList.toggle('is-selected', selected);
    this.label.classList.toggle('is-dimmed', dimmed && !selected);
  }

  private rebuild(): void {
    disposeChildren(this.group);
    this.group.add(this.anchor);

    const outline = this.stall.outline;
    if (outline.length < 3) return;

    const colorBase = this.stall.available ? '#22c55e' : '#f97316';
    const colorAccent = this.stall.available ? '#16a34a' : '#ea580c';
    const floorColor = this.stall.available ? '#ecfdf5' : '#fff7ed';
    const h = Math.max(1.2, this.stall.stall.height || 2.5);
    this.topY = h;

    const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x, -p.z)));
    const floorGeom = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    const floor = new THREE.Mesh(
      floorGeom,
      new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.78, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    floor.userData['stallId'] = this.stall.id;
    this.group.add(floor);

    const openSet = new Set(this.stall.edges.map((e, i) => (e.open ? i : -1)).filter(i => i >= 0));
    const wall = 0.14;
    const wallMat = new THREE.MeshStandardMaterial({
      color: colorBase,
      roughness: 0.5,
      metalness: 0.06,
      transparent: this.dimmed,
      opacity: this.dimmed ? 0.3 : 1
    });

    this.stall.edges.forEach((edge, i) => {
      if (openSet.has(i)) return;
      const a = edge.a, b = edge.b;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) return;
      const geom = new THREE.BoxGeometry(len, h, wall);
      const mesh = new THREE.Mesh(geom, wallMat);
      mesh.position.set((a.x + b.x) / 2, h / 2, (a.z + b.z) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData['stallId'] = this.stall.id;
      this.group.add(mesh);
    });

    // Top accent cornice for a cleaner stall silhouette.
    const corniceMat = new THREE.MeshStandardMaterial({
      color: colorAccent,
      roughness: 0.4,
      metalness: 0.1,
      transparent: this.dimmed,
      opacity: this.dimmed ? 0.3 : 1
    });
    this.stall.edges.forEach((edge, i) => {
      if (openSet.has(i)) return;
      const a = edge.a, b = edge.b;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) return;
      const geom = new THREE.BoxGeometry(len, 0.18, wall + 0.04);
      const mesh = new THREE.Mesh(geom, corniceMat);
      mesh.position.set((a.x + b.x) / 2, h + 0.09, (a.z + b.z) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.userData['stallId'] = this.stall.id;
      this.group.add(mesh);
    });

    if (this.selected) {
      const points = outline.map(p => new THREE.Vector3(p.x, 0.08, p.z));
      points.push(points[0].clone());
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: '#2563eb' })
      );
      this.group.add(ring);
    }

    this.anchor.position.set(this.stall.label.at.x, h + 0.6, this.stall.label.at.z);
  }

  projectLabel(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const world = new THREE.Vector3();
    this.anchor.getWorldPosition(world);
    const ndc = world.clone().project(camera);
    if (ndc.z > 1) {
      this.label.style.display = 'none';
      return;
    }
    const x = (ndc.x * 0.5 + 0.5) * width;
    const y = (-ndc.y * 0.5 + 0.5) * height;
    this.label.style.display = 'block';
    this.label.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
  }

  dispose(): void {
    disposeChildren(this.group);
    this.label.remove();
    this.group.removeFromParent();
  }
}

// --- builders ------------------------------------------------------------------------------------

function buildFloor(hall: Hall): THREE.Group {
  const group = new THREE.Group();
  const outlines = floorOutlines(hall);

  if (outlines.length) {
    for (const poly of outlines) {
      const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, -p.z)));
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.9, metalness: 0 })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  } else {
    const { width, length } = planSize(hall);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.9, metalness: 0 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const grid = new THREE.GridHelper(400, 400, 0xcbd5e1, 0xe2e8f0);
  (grid.material as THREE.Material).opacity = 0.35;
  (grid.material as THREE.Material).transparent = true;
  grid.position.y = 0.001;
  group.add(grid);

  return group;
}

function buildBoundaryWalls(hall: Hall): THREE.Group {
  const group = new THREE.Group();
  const outlines = floorOutlines(hall);
  if (!outlines.length) {
    const { width, length } = planSize(hall);
    outlines.push([
      { x: -width / 2, z: -length / 2 },
      { x: width / 2, z: -length / 2 },
      { x: width / 2, z: length / 2 },
      { x: -width / 2, z: length / 2 }
    ]);
  }
  const wallH = 0.8;
  const wallT = 0.3;
  const mat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.75, metalness: 0.05 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.6 });

  for (const poly of outlines) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const geom = new THREE.BoxGeometry(len, wallH, wallT);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set((a.x + b.x) / 2, wallH / 2, (a.z + b.z) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, wallT + 0.06), capMat);
      cap.position.set((a.x + b.x) / 2, wallH + 0.04, (a.z + b.z) / 2);
      cap.rotation.y = -Math.atan2(dz, dx);
      group.add(cap);
    }
  }
  return group;
}

function buildOpening(opening: HallOpening, overlay: HTMLElement): THREE.Object3D | null {
  if (!Number.isFinite(opening.position?.x) || !Number.isFinite(opening.position?.z)) return null;
  const emergency = opening.kind === 'EMERGENCY';
  const width = opening.width > 0 ? opening.width : 2.5;
  const group = new THREE.Group();
  const across = opening.facing === 'NORTH' || opening.facing === 'SOUTH';

  const frameColor = emergency ? '#dc2626' : '#16a34a';
  const frameMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.4, metalness: 0.1 });
  const archH = 2.8;
  const archT = 0.25;
  const legW = 0.3;

  // Two legs + top beam, forming a portal
  const legGeom = new THREE.BoxGeometry(legW, archH, archT);
  const topGeom = new THREE.BoxGeometry(width + legW * 2, 0.4, archT);

  const left = new THREE.Mesh(legGeom, frameMat);
  const right = new THREE.Mesh(legGeom, frameMat);
  const top = new THREE.Mesh(topGeom, frameMat);

  if (across) {
    left.position.set(-width / 2 - legW / 2, archH / 2, 0);
    right.position.set(width / 2 + legW / 2, archH / 2, 0);
    top.position.set(0, archH + 0.2, 0);
  } else {
    left.position.set(0, archH / 2, -width / 2 - legW / 2);
    right.position.set(0, archH / 2, width / 2 + legW / 2);
    top.position.set(0, archH + 0.2, 0);
    top.rotation.y = Math.PI / 2;
    left.rotation.y = Math.PI / 2;
    right.rotation.y = Math.PI / 2;
  }
  group.add(left, right, top);

  group.position.set(opening.position.x, 0, opening.position.z);

  const label = document.createElement('div');
  label.className = emergency ? 'xv3-marker emergency' : 'xv3-marker entrance';
  label.textContent = opening.label || (emergency ? 'EMERGENCY EXIT' : opening.kind);
  overlay.appendChild(label);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, archH + 1.1, 0);
  group.add(anchor);

  const projector = (camera: THREE.PerspectiveCamera, w: number, h: number): void => {
    const world = new THREE.Vector3();
    anchor.getWorldPosition(world);
    const ndc = world.clone().project(camera);
    if (ndc.z > 1) { label.style.display = 'none'; return; }
    const x = (ndc.x * 0.5 + 0.5) * w;
    const y = (-ndc.y * 0.5 + 0.5) * h;
    label.style.display = 'block';
    label.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
  };
  group.userData['projectLabel'] = projector;
  group.userData['labelEl'] = label;
  return group;
}

function buildMarker(marker: HallMarker, overlay: HTMLElement): THREE.Object3D | null {
  if (!marker.text?.trim() || !Number.isFinite(marker.position?.x) || !Number.isFinite(marker.position?.z)) return null;
  const group = new THREE.Group();
  group.position.set(marker.position.x, 0, marker.position.z);

  const label = document.createElement('div');
  label.className = 'xv3-text-marker';
  label.textContent = marker.text;
  overlay.appendChild(label);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 0.5, 0);
  group.add(anchor);

  const projector = (camera: THREE.PerspectiveCamera, w: number, h: number): void => {
    const world = new THREE.Vector3();
    anchor.getWorldPosition(world);
    const ndc = world.clone().project(camera);
    if (ndc.z > 1) { label.style.display = 'none'; return; }
    const x = (ndc.x * 0.5 + 0.5) * w;
    const y = (-ndc.y * 0.5 + 0.5) * h;
    label.style.display = 'block';
    label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  };
  group.userData['projectLabel'] = projector;
  group.userData['labelEl'] = label;
  return group;
}

function buildAmenity(amenity: HallAmenity, overlay: HTMLElement): THREE.Object3D | null {
  if (!Number.isFinite(amenity.position?.x) || !Number.isFinite(amenity.position?.z)) return null;
  const group = new THREE.Group();
  group.position.set(amenity.position.x, 0, amenity.position.z);

  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 1.6, 10),
    new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.5 })
  );
  pillar.position.y = 0.8;
  pillar.castShadow = true;
  group.add(pillar);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: '#1e40af', roughness: 0.4, metalness: 0.2 })
  );
  sign.position.set(0, 2.0, 0);
  sign.castShadow = true;
  group.add(sign);

  const label = document.createElement('div');
  label.className = 'xv3-amenity';
  label.textContent = amenity.label || 'Info';
  overlay.appendChild(label);

  const anchor = new THREE.Object3D();
  anchor.position.set(0, 2.1, 0);
  group.add(anchor);

  const projector = (camera: THREE.PerspectiveCamera, w: number, h: number): void => {
    const world = new THREE.Vector3();
    anchor.getWorldPosition(world);
    const ndc = world.clone().project(camera);
    if (ndc.z > 1) { label.style.display = 'none'; return; }
    const x = (ndc.x * 0.5 + 0.5) * w;
    const y = (-ndc.y * 0.5 + 0.5) * h;
    label.style.display = 'block';
    label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  };
  group.userData['projectLabel'] = projector;
  group.userData['labelEl'] = label;
  return group;
}

// --- utilities ---------------------------------------------------------------------------------

function disposeChildren(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse(child => {
    const mesh = child as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(m => materials.add(m));
    else if (material) materials.add(material);
  });
  materials.forEach(m => m.dispose());
  root.clear();
}

function disposeLabels(group: THREE.Group, _overlay: HTMLElement): void {
  group.traverse(child => {
    const el = child.userData['labelEl'] as HTMLElement | undefined;
    el?.remove();
  });
}

function escape(text: string): string {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
