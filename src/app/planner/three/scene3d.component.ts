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

import { GridSystem } from '../geometry/grid-system';
import { effectiveRules, Point } from '../geometry/placement-rules';
import { hallSize } from '../geometry/planner-geometry';
import { EventType, Hall } from '../models/hall.model';
import { GateSide, Stall } from '../models/stall.model';
import type { EditorMode, EditorOverlay, FocusTarget } from '../planner-store.service';
import { buildFreeSpace, buildPreview, buildViolations } from './editor-overlay-renderer';
import { buildHallBoundary } from './hall-boundary-renderer';
import { buildHallGrid } from './hall-grid-renderer';
import { buildBlockedAreas } from './blocked-areas-renderer';
import { disposeChildren, StallObject } from './stall3d-renderer';
import { disposeSpriteTextures } from './text-sprite';
import { buildClearances, buildMarkers, buildRestrictedZones } from './zones-renderer';

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
  /** Draw mode: dragging on the grid creates a stall instead of orbiting / selecting. */
  readonly mode = input<EditorMode>('select');
  readonly editorOverlay = input<EditorOverlay | null>(null);
  readonly showClearances = input(true);
  readonly eventType = input<EventType>('B2B');
  readonly focusTarget = input<FocusTarget | null>(null);

  readonly selectStall = output<string | number | null>();
  readonly moveStall = output<StallMove>();
  readonly dragState = output<boolean>();
  readonly openSideChange = output<StallOpenSide>();
  /** Draw mode pointer on the grid (world metres on the floor plane). */
  readonly draftHover = output<Point>();
  readonly draftStart = output<Point>();
  readonly draftMove = output<Point>();
  readonly draftEnd = output<void>();
  readonly draftLeave = output<void>();
  /** The suggested-spot ghost of a rejected placement was clicked. */
  readonly acceptSuggestion = output<void>();

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

  // Scene layers, one group each, so every kind of geometry stays separately addressable:
  /** 1. Hall boundary: polygon floor + walls, or the legacy rectangle/circle floor and border. */
  private readonly hallGroup = new THREE.Group();
  /** 2. Grid, clipped to the boundary polygon when there is one. */
  private readonly gridGroup = new THREE.Group();
  /** Legacy irregular-hall masks (halls without a boundary polygon). */
  private readonly blockedAreasGroup = new THREE.Group();
  /** 3. Restricted areas (zones). */
  private readonly restrictedGroup = new THREE.Group();
  /** 4. Pathway / clearance visualisation. */
  private readonly clearanceGroup = new THREE.Group();
  /** 5. Existing stalls. */
  private readonly stallGroup = new THREE.Group();
  /** 6. Drag preview + suggested spot. */
  private readonly previewGroup = new THREE.Group();
  /** 7. Validation / violation overlays. */
  private readonly violationGroup = new THREE.Group();
  /** 8. Entry/exit markers and plan labels. */
  private readonly markerGroup = new THREE.Group();
  /** "Show free space" cells. */
  private readonly freeSpaceGroup = new THREE.Group();
  /** Draw-mode drag in progress (pointer id), null otherwise. */
  private drawPointerId: number | null = null;
  /** Hall the camera was last framed on, so a re-sync of the same hall keeps the view. */
  private framedHallId: string | null = null;
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

    // Clearance bands and opening access areas depend on the rules view, not only the hall.
    effect(() => {
      const hall = this.hall();
      const show = this.showClearances();
      const eventType = this.eventType();
      if (!this.ready) return;
      this.syncClearances(hall, show, eventType);
    });

    // Draft preview, violation overlays, suggestion and free space.
    effect(() => {
      const overlay = this.editorOverlay();
      const hall = this.hall();
      if (!this.ready) return;
      this.syncOverlay(overlay, hall);
    });

    // "Locate": move the camera to a problem.
    effect(() => {
      const target = this.focusTarget();
      if (!this.ready || !target) return;
      this.focusOn(target);
    });

    // Leaving draw mode ends any drag in progress. Esc can do that mid-drag, while pointerdown
    // still has the orbit controls switched off and the pointer captured - undo both, as
    // onPointerUp would, or the camera stays frozen.
    effect(() => {
      if (this.mode() === 'draw' || this.drawPointerId === null) return;
      if (this.ready) {
        this.controls.enabled = !this.dragging();
        const canvas = this.renderer.domElement;
        if (canvas.hasPointerCapture?.(this.drawPointerId)) canvas.releasePointerCapture(this.drawPointerId);
      }
      this.drawPointerId = null;
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  ngAfterViewInit(): void {
    const host = this.host().nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e6eaf0');
    this.scene.add(
      this.hallGroup,
      this.gridGroup,
      this.blockedAreasGroup,
      this.restrictedGroup,
      this.clearanceGroup,
      this.freeSpaceGroup,
      this.stallGroup,
      this.previewGroup,
      this.violationGroup,
      this.markerGroup
    );

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
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
    // 250 lets a 133 m hall (Hall 8-9-10) be seen whole.
    this.controls.maxDistance = 250;
    this.controls.maxPolarAngle = Math.PI / 2.05;

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.ready = true;
    this.resize();
    this.syncHall(this.hall());
    this.syncStalls(this.hall(), this.stalls(), this.selectedStallId());
    this.syncClearances(this.hall(), this.showClearances(), this.eventType());
    this.syncOverlay(this.editorOverlay(), this.hall());
    this.controls.enabled = !this.dragging();

    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
      this.animate();
    });
  }

  // --- scene synchronisation ----------------------------------------------

  private syncHall(hall: Hall | undefined): void {
    disposeLayer(this.hallGroup);
    disposeLayer(this.gridGroup);
    disposeLayer(this.blockedAreasGroup);
    disposeLayer(this.restrictedGroup);
    disposeLayer(this.markerGroup);
    if (!hall) return;

    const { width, length } = hallSize(hall);
    const grid = GridSystem.forHall(hall);

    if (hall.boundary && hall.boundary.length >= 3) {
      // Real outline: the floor IS the polygon, the grid is clipped to it. No masks needed.
      this.hallGroup.add(buildHallBoundary(hall.boundary));
      this.gridGroup.add(buildHallGrid(width, length, hall.shape, grid, hall.boundary));
      this.restrictedGroup.add(buildRestrictedZones(hall.zones ?? [], effectiveRules(hall.rules)));
      this.markerGroup.add(buildMarkers(hall.markers ?? [], hall.openings ?? []));
      this.frameHall(hall, grid);
      return;
    }

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

    this.gridGroup.add(buildHallGrid(width, length, hall.shape, grid));
    this.blockedAreasGroup.add(buildBlockedAreas(hall));
    if (hall.zones?.length) {
      this.restrictedGroup.add(buildRestrictedZones(hall.zones, effectiveRules(hall.rules)));
    }
    if (hall.markers?.length || hall.openings?.length) {
      this.markerGroup.add(buildMarkers(hall.markers ?? [], hall.openings ?? []));
    }
  }

  private syncClearances(hall: Hall | undefined, show: boolean, eventType: EventType): void {
    disposeLayer(this.clearanceGroup);
    if (!hall?.rules || !show) return;
    this.clearanceGroup.add(
      buildClearances(hall.boundary ?? null, hall.openings ?? [], effectiveRules(hall.rules), eventType)
    );
  }

  private syncOverlay(overlay: EditorOverlay | null, hall: Hall | undefined): void {
    disposeLayer(this.previewGroup);
    disposeLayer(this.violationGroup);
    disposeLayer(this.freeSpaceGroup);
    if (!overlay || !hall) return;

    this.previewGroup.add(buildPreview(overlay));
    this.violationGroup.add(buildViolations(overlay));
    this.freeSpaceGroup.add(buildFreeSpace(overlay.freeSpace, GridSystem.forHall(hall).cellSize));
  }

  /** Fit a large irregular hall into view once, when it is first shown. */
  private frameHall(hall: Hall, grid: GridSystem): void {
    const key = String(hall.id);
    if (this.framedHallId === key) return;
    this.framedHallId = key;
    this.focusOn({ rect: grid.bounds, seq: 0 }, 0.9);
  }

  private focusOn(target: FocusTarget, fill = 0.35): void {
    const { rect } = target;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    // Distance at which the area spans roughly `fill` of the view, in whichever direction is
    // tighter: a long hall like Hall 8-9-10 (129 x 41 m) is limited by the width, not the height.
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const width = Math.max(rect.maxX - rect.minX, 6);
    const depth = Math.max(rect.maxZ - rect.minZ, 6);
    const distance = Math.min(
      this.controls.maxDistance,
      Math.max(width / (2 * Math.tan(hHalf)), depth / (2 * Math.tan(vHalf))) / fill
    );

    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, distance * 0.82, cz + distance * 0.58);
    this.controls.update();
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
    // The suggested spot of a rejected placement can be clicked in either mode.
    if (event.button === 0 && this.pickSuggestion(event)) {
      this.pointerDownHit = true;
      this.acceptSuggestion.emit();
      return;
    }

    if (this.mode() === 'draw') {
      this.pointerDownHit = true;
      if (event.button !== 0) return; // right/middle drag still orbits and pans
      const point = this.intersectDragPlane(event);
      if (!point) return;

      this.controls.enabled = false;
      this.drawPointerId = event.pointerId;
      this.draftStart.emit({ x: point.x, z: point.z });
      this.renderer.domElement.setPointerCapture?.(event.pointerId);
      return;
    }

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
    if (this.mode() === 'draw') {
      const point = this.intersectDragPlane(event);
      if (!point) return;
      if (this.drawPointerId === event.pointerId) {
        this.draftMove.emit({ x: point.x, z: point.z });
      } else if (this.drawPointerId === null && event.buttons === 0) {
        this.draftHover.emit({ x: point.x, z: point.z });
      }
      return;
    }

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
    if (this.drawPointerId !== null && this.drawPointerId === event.pointerId) {
      this.drawPointerId = null;
      this.controls.enabled = !this.dragging();
      this.draftEnd.emit();
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
      return;
    }

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

  private readonly onPointerLeave = (): void => {
    if (this.mode() === 'draw' && this.drawPointerId === null) this.draftLeave.emit();
  };

  /** Did the pointer hit the suggested-spot ghost? */
  private pickSuggestion(event: PointerEvent): boolean {
    if (!this.previewGroup.children.length) return false;
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster
      .intersectObjects(this.previewGroup.children, true)
      .some(hit => hit.object.userData['suggestion'] === true && hit.object instanceof THREE.Mesh);
  }

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
    canvas.removeEventListener('pointerleave', this.onPointerLeave);

    this.stallObjects.forEach(object => object.dispose());
    this.stallObjects.clear();
    for (const layer of [
      this.hallGroup,
      this.gridGroup,
      this.blockedAreasGroup,
      this.restrictedGroup,
      this.clearanceGroup,
      this.freeSpaceGroup,
      this.previewGroup,
      this.violationGroup,
      this.markerGroup
    ]) {
      disposeLayer(layer);
    }
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

/** Free one layer: sprite canvas textures first, then every geometry and material. */
function disposeLayer(group: THREE.Group): void {
  disposeSpriteTextures(group);
  disposeChildren(group);
}
