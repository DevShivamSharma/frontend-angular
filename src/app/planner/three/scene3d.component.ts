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
  viewChild
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { hallSize } from '../geometry/planner-geometry';
import { Hall } from '../models/hall.model';
import { GateSide, Stall } from '../models/stall.model';
import { buildHallGrid } from './hall-grid-renderer';
import { buildBlockedAreas } from './blocked-areas-renderer';
import { disposeChildren, StallObject } from './stall3d-renderer';

/** Payload of the `moveStall` output. */
export interface StallMove {
  id: string | number;
  x: number;
  z: number;
}

/** Payload of the `openSideChange` output: a wall of an already-selected stall was clicked. */
export interface StallOpenSide {
  id: string | number;
  side: GateSide;
}

/** Drag must exceed this before it counts as a move. App.js:167. */
const DRAG_THRESHOLD = 0.05;

/**
 * The 3D canvas. Replaces the react-three-fiber `<Canvas>` plus the `Scene3D`
 * component (App.js:457-477, App.js:595).
 *
 * There is no Angular equivalent of react-three-fiber, so this component owns
 * the Three.js lifecycle directly: it creates the renderer once, then keeps the
 * scene in sync with its inputs through effects. All validation stays in the
 * store - this component only reports the raw pointer position.
 */
@Component({
  selector: 'app-scene3d',
  templateUrl: './scene3d.component.html',
  styleUrl: './scene3d.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Scene3dComponent implements AfterViewInit {
  readonly hall = input<Hall | undefined>(undefined);
  readonly stalls = input<ReadonlyArray<Stall>>([]);
  readonly selectedStallId = input<string | number | null>(null);
  readonly dragging = input(false);

  readonly selectStall = output<string | number | null>();
  readonly moveStall = output<StallMove>();
  readonly dragState = output<boolean>();
  readonly openSideChange = output<StallOpenSide>();

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

  /** Group holding the floor, border and grid of the current hall. */
  private readonly hallGroup = new THREE.Group();
  /** Group holding the irregular-geometry masks, walls and zones of the current hall. */
  private readonly blockedAreasGroup = new THREE.Group();
  private readonly stallGroup = new THREE.Group();
  private readonly stallObjects = new Map<string, StallObject>();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag: {
    id: string | number;
    pointerId: number;
    startPointer: { x: number; z: number };
    startPos: { x: number; z: number };
    moved: boolean;
    /** The wall side under the pointer at pointerdown, if a wall was hit. */
    side?: GateSide;
    /** Whether the stall was already selected before this click. */
    wasSelected: boolean;
  } | null = null;

  /**
   * Whether the pointerdown that started the current click hit a stall.
   *
   * react-three-fiber decides `onPointerMissed` from the hits recorded at
   * pointerdown, not from where the pointer was released. Re-raycasting on
   * `click` would clear the selection every time a stall is dragged out from
   * under the cursor.
   */
  private pointerDownHit = false;

  constructor() {
    // Rebuild the hall whenever its shape or size changes.
    effect(() => {
      const hall = this.hall();
      if (!this.ready) return;
      this.syncHall(hall);
    });

    // Add/update/remove stall objects.
    effect(() => {
      const hall = this.hall();
      const stalls = this.stalls();
      const selectedStallId = this.selectedStallId();
      if (!this.ready) return;
      this.syncStalls(hall, stalls, selectedStallId);
    });

    // Orbit controls are disabled while a stall is being dragged. App.js:475.
    effect(() => {
      const dragging = this.dragging();
      if (!this.ready) return;
      this.controls.enabled = !dragging;
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  ngAfterViewInit(): void {
    const host = this.host().nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dbe5ef');
    this.scene.add(this.hallGroup, this.blockedAreasGroup, this.stallGroup);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    this.camera.position.set(0, 35, 38);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // react-three-fiber's defaults, kept so colours match the React build.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.styleCanvas(this.renderer.domElement);
    host.appendChild(this.renderer.domElement);

    // Lighting. App.js:462-463.
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const directional = new THREE.DirectionalLight(0xffffff, 1.8);
    directional.position.set(20, 35, 15);
    directional.castShadow = true;
    this.scene.add(directional);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.minDistance = 5;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI / 2.05;

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('click', this.onClick);

    this.ready = true;
    this.resize();
    this.syncHall(this.hall());
    this.syncStalls(this.hall(), this.stalls(), this.selectedStallId());
    this.controls.enabled = !this.dragging();

    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
      this.animate();
    });
  }

  // --- scene synchronisation ----------------------------------------------

  private syncHall(hall: Hall | undefined): void {
    disposeChildren(this.hallGroup);
    disposeChildren(this.blockedAreasGroup);
    if (!hall) return;

    const { width, length } = hallSize(hall);

    // Hall floor.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.78 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.hallGroup.add(floor);

    if (hall.shape === 'CIRCLE') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0, width / 2 - 0.06), width / 2, 96),
        new THREE.MeshBasicMaterial({ color: '#475569', side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.015;
      this.hallGroup.add(ring);
    } else {
      const border = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 0.08, length + 0.08),
        new THREE.MeshBasicMaterial({ color: '#334155', wireframe: true })
      );
      border.rotation.x = -Math.PI / 2;
      border.position.y = 0.02;
      this.hallGroup.add(border);
    }

    this.hallGroup.add(buildHallGrid(width, length, hall.shape));
    this.blockedAreasGroup.add(buildBlockedAreas(hall));
  }

  private syncStalls(
    hall: Hall | undefined,
    stalls: ReadonlyArray<Stall>,
    selectedStallId: string | number | null
  ): void {
    const hallStalls = hall
      ? stalls.filter(s => String(s.hallId) === String(hall.id))
      : [];
    const seen = new Set<string>();

    for (const stall of hallStalls) {
      const key = String(stall.id);
      seen.add(key);

      let object = this.stallObjects.get(key);
      if (!object) {
        object = new StallObject(stall, this.overlay().nativeElement);
        this.stallObjects.set(key, object);
        this.stallGroup.add(object.group);
      }

      object.update(stall, String(selectedStallId) === key);
    }

    for (const [key, object] of this.stallObjects) {
      if (!seen.has(key)) {
        object.dispose();
        this.stallObjects.delete(key);
      }
    }
  }

  // --- pointer interaction -------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    const hit = this.pickStall(event);
    this.pointerDownHit = hit !== null;
    if (!hit) return;

    const point = this.intersectDragPlane(event);
    if (!point) return;

    // Stop the orbit controls immediately so the camera does not rotate while
    // the stall is dragged. React does the same through `enabled={!dragging}`.
    this.controls.enabled = false;

    this.drag = {
      id: hit.stall.id,
      pointerId: event.pointerId,
      startPointer: { x: point.x, z: point.z },
      startPos: { x: hit.stall.posX, z: hit.stall.posZ },
      moved: false,
      side: hit.side,
      wasSelected: String(this.selectedStallId()) === String(hit.stall.id)
    };

    this.selectStall.emit(hit.stall.id);
    this.dragState.emit(true);
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;

    const point = this.intersectDragPlane(event);
    if (!point) return;

    const dx = point.x - this.drag.startPointer.x;
    const dz = point.z - this.drag.startPointer.z;

    if (Math.abs(dx) + Math.abs(dz) > DRAG_THRESHOLD) {
      this.drag.moved = true;
    }

    if (!this.drag.moved) return;

    this.moveStall.emit({
      id: this.drag.id,
      x: this.drag.startPos.x + dx,
      z: this.drag.startPos.z + dz
    });
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drag) return;

    const { id, moved, pointerId, side, wasSelected } = this.drag;
    this.drag = null;
    this.dragState.emit(false);

    if (!moved) {
      // A click on a wall of an already-selected stall changes its open side
      // instead of re-selecting. First clicks and clicks on the floor,
      // markers or outline still only select.
      if (side && wasSelected) {
        this.openSideChange.emit({ id, side });
      } else {
        this.selectStall.emit(id);
      }
    }

    this.renderer.domElement.releasePointerCapture?.(pointerId);
    void event;
  };

  /** Clicking empty space clears the selection. React's `onPointerMissed`. */
  private readonly onClick = (): void => {
    if (this.pointerDownHit) return;
    this.selectStall.emit(null);
  };

  /** Find the stall under the pointer, plus the wall side if a wall was hit. */
  private pickStall(event: PointerEvent | MouseEvent): { stall: Stall; side?: GateSide } | null {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects(this.stallGroup.children, true);
    if (!hits.length) return null;

    const side = hits[0].object.userData['side'] as GateSide | undefined;

    let node: THREE.Object3D | null = hits[0].object;
    while (node && node.userData['stallId'] === undefined) {
      node = node.parent;
    }
    if (!node) return null;

    const id = String(node.userData['stallId']);
    const stall = this.stalls().find(s => String(s.id) === id);
    return stall ? { stall, side } : null;
  }

  private intersectDragPlane(event: PointerEvent | MouseEvent): THREE.Vector3 | null {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.dragPlane, target) ? target : null;
  }

  private updatePointer(event: PointerEvent | MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  // --- render loop ---------------------------------------------------------

  private readonly animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const { clientWidth, clientHeight } = this.host().nativeElement;
    for (const object of this.stallObjects.values()) {
      object.projectLabels(this.camera, clientWidth, clientHeight);
    }
  };

  /**
   * Style the canvas from here rather than from `scene3d.component.css`.
   *
   * Three.js creates this element, so Angular never stamps its view-
   * encapsulation attribute onto it and no scoped `canvas` selector can ever
   * match it. Taking it out of flow is what matters: `renderer.setSize(w, h,
   * false)` writes the drawing-buffer size to the width/height attributes
   * without touching the inline style, so an in-flow canvas would resolve its
   * own height from that buffer whenever an ancestor is content-sized. That is
   * a feedback loop - buffer grows, element grows, ResizeObserver fires, buffer
   * grows - which ran to millions of pixels at mobile widths, where `.planner`
   * switches to `height: auto`.
   */
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
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('click', this.onClick);

    this.stallObjects.forEach(object => object.dispose());
    this.stallObjects.clear();
    disposeChildren(this.hallGroup);
    disposeChildren(this.blockedAreasGroup);
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
