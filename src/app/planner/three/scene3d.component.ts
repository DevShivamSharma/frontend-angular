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
import { effectiveRules, Point, Rect } from '../geometry/placement-rules';
import { hallSize } from '../geometry/planner-geometry';
import { EventType, Hall } from '../models/hall.model';
import { GateSide, Stall } from '../models/stall.model';
import type { EditorMode, EditorOverlay, FocusTarget } from '../planner-store.service';
import { buildFreeSpace, buildPreview, buildProposals, buildViolations } from './editor-overlay-renderer';
import { buildHallBoundary } from './hall-boundary-renderer';
import { buildHallGrid } from './hall-grid-renderer';
import { annotationBounds, buildAmenityCards, buildCompass, buildExitLabels } from './annotations-renderer';
import { hallFloor, planBounds } from '../geometry/hall-plan';
import { buildFloorRegions, buildPlanAreas, UD_TOOLTIP } from './plan-renderer';
import { disposeChildren, StallObject } from './stall3d-renderer';
import { disposeSpriteTextures } from './text-sprite';
import { buildPlanningZones, buildClearances, buildOpeningMarkers, buildRestrictedZones } from './zones-renderer';

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

/**
 * A camera command from the view dock. `seq` makes a repeat of the same command
 * distinct, the way `FocusTarget` does for "Locate".
 */
export interface ViewCommand {
  kind: 'reset' | 'fit' | 'top';
  seq: number;
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
  readonly selectedStallIds = input<readonly string[]>([]);
  readonly toggleStall = output<string | number>();
  readonly selectedStallId = input<string | number | null>(null);
  readonly dragging = input(false);
  /** Draw mode: dragging on the grid creates a stall instead of orbiting / selecting. */
  readonly mode = input<EditorMode>('select');
  readonly editorOverlay = input<EditorOverlay | null>(null);
  readonly showClearances = input(true);
  /** Tags over every stall; the selected stall shows its own either way. */
  readonly showLabels = input(true);
  readonly eventType = input<EventType>('B2B');
  readonly focusTarget = input<FocusTarget | null>(null);
  /** Reset / fit / top-down, from the view dock over the stage. */
  readonly viewCommand = input<ViewCommand | null>(null);

  readonly selectStall = output<string | number | null>();
  readonly moveStall = output<StallMove>();
  readonly dragState = output<boolean>();
  readonly openSideChange = output<StallOpenSide>();
  /** Draw mode pointer on the grid (world metres on the floor plane). */
  readonly draftHover = output<Point>();
  readonly draftStart = output<Point>();
  readonly draftMove = output<Point>();
  readonly draftEnd = output<void>();
  readonly draftCancel = output<void>();
  readonly draftLeave = output<void>();
  /** The suggested-spot ghost of a rejected placement was clicked. */
  readonly acceptSuggestion = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly overlay = viewChild.required<ElementRef<HTMLDivElement>>('overlay');
  private readonly tooltip = viewChild.required<ElementRef<HTMLDivElement>>('tooltip');

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
  /** 9. The plan's annotations: icon cards, gate / foyer captions, north arrow. Visual only. */
  private readonly amenityGroup = new THREE.Group();
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
      this.selectedStallIds();
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

    // View dock: put the camera back somewhere useful.
    effect(() => {
      const command = this.viewCommand();
      const hall = this.hall();
      if (!this.ready || !command || !hall) return;
      this.applyView(command, hall);
    });

    // Leaving draw mode ends any drag in progress. Esc can do that mid-drag, while pointerdown
    // still has the orbit controls switched off and the pointer captured - undo both, as
    // onPointerUp would, or the camera stays frozen.
    effect(() => {
      const mode = this.mode();
      if (this.ready) this.updateCursor();
      if (mode === 'draw' || mode === 'zone' || this.drawPointerId === null) return;
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
      this.markerGroup,
      this.amenityGroup
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
    // Initial zoom range; framing expands it for large plans on narrow screens.
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
    this.updateCursor();

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
    disposeLayer(this.amenityGroup);
    this.hideTooltip();
    if (!hall) return;

    const { width, length } = hallSize(hall);
    const grid = GridSystem.forHall(hall);
    const floor = hallFloor(hall);

    if (floor.length) {
      // A hall with a source plan: every floor region the plan draws (a foyer below the main
      // floor, floor past the breadth), the plan's own walls and coloured areas, grid on the floor
      // only. The rectangles are the source of truth, whatever `boundary` the hall stores.
      this.hallGroup.add(buildFloorRegions(floor));
      this.gridGroup.add(buildHallGrid(grid.width, grid.length, hall.shape, grid, floor.flatMap(r => [r.outer, ...r.holes])));
      this.blockedAreasGroup.add(buildPlanAreas(hall.blockedAreas ?? [], { drawOutside: false }));
    } else if (hall.boundary && hall.boundary.length >= 3) {
      // Real outline without plan rectangles: the floor IS the polygon, the grid is clipped to it.
      this.hallGroup.add(buildHallBoundary(hall.boundary));
      this.gridGroup.add(buildHallGrid(width, length, hall.shape, grid, hall.boundary));
      this.blockedAreasGroup.add(buildPlanAreas(hall.blockedAreas ?? [], { drawOutside: false }));
    } else {
      this.hallGroup.add(buildPlainFloor(width, length, hall.shape));
      this.gridGroup.add(buildHallGrid(width, length, hall.shape, grid));
      this.blockedAreasGroup.add(buildPlanAreas(hall.blockedAreas ?? [], { drawOutside: true }));
    }

    if (hall.planningZones?.length) this.restrictedGroup.add(buildPlanningZones(hall.planningZones));
    if (hall.zones?.length) {
      // Clearance outlines belong to the rule engine; a hall without rules shows the plan as is.
      this.restrictedGroup.add(buildRestrictedZones(hall.zones, effectiveRules(hall.rules), !!hall.rules));
    }
    if (hall.openings?.length) this.markerGroup.add(buildOpeningMarkers(hall.openings));
    this.markerGroup.add(buildExitLabels(hall.markers ?? []));
    this.amenityGroup.add(buildAmenityCards(hall));
    this.amenityGroup.add(buildCompass(hall.compass));

    // Frame every hall once, with its annotations: the default camera suits a ~40 m room, and
    // SelfCare puts icons and the north arrow outside the outline.
    this.frameHall(hall);
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
    this.previewGroup.add(buildProposals(overlay.proposals));
    this.violationGroup.add(buildViolations(overlay));
    this.freeSpaceGroup.add(buildFreeSpace(overlay.freeSpace, GridSystem.forHall(hall).cellSize));
  }

  /** Fit a large irregular hall into view once, when it is first shown. */
  private frameHall(hall: Hall): void {
    const key = String(hall.id);
    if (this.framedHallId === key) return;
    this.framedHallId = key;
    this.focusOn({ rect: this.planRect(hall), seq: 0 }, 0.9);
  }

  /** The hall's plan with its icon cards, captions and compass. */
  private planRect(hall: Hall): Rect {
    const plan = planBounds(hall);
    const notes = annotationBounds(hall);
    return notes
      ? {
          minX: Math.min(plan.minX, notes.minX),
          maxX: Math.max(plan.maxX, notes.maxX),
          minZ: Math.min(plan.minZ, notes.minZ),
          maxZ: Math.max(plan.maxZ, notes.maxZ)
        }
      : plan;
  }

  private focusOn(target: FocusTarget, fill = 0.35): void {
    const { rect } = target;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const distance = this.frameDistance(rect, fill);

    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, distance * 0.82, cz + distance * 0.58);
    this.controls.update();
  }

  /**
   * Distance at which `rect` spans roughly `fill` of the view, in whichever direction is
   * tighter: a long hall like Hall 8-9-10 (129 x 41 m) is limited by the width, not the height.
   */
  private frameDistance(rect: Rect, fill: number, perspective = true): number {
    const viewport = this.framingViewport();
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const width = Math.max(rect.maxX - rect.minX, 6);
    const depth = Math.max(rect.maxZ - rect.minZ, 6);
    const horizontal = width / (2 * Math.tan(hHalf) * viewport.widthFraction * fill);
    const vertical = depth / (2 * Math.tan(vHalf) * viewport.heightFraction * fill);
    // focusOn tilts the camera by (0, .82, .58). The near edge projects larger than the
    // centre plane; include its depth so foreground cards do not leave the left/right edges.
    const tiltLength = Math.hypot(0.82, 0.58);
    const distance = perspective
      ? (Math.max(horizontal, vertical * 0.82 / tiltLength) + depth / 2 * 0.58 / tiltLength) / tiltLength
      : Math.max(horizontal, vertical);
    // A fixed 250 m cap clips perimeter cards on portrait screens. Leave enough zoom range
    // for the measured plan and keep the far plane beyond it.
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 1.1);
    this.camera.far = Math.max(this.camera.far, this.controls.maxDistance + Math.max(width, depth));
    this.camera.updateProjectionMatrix();
    return distance;
  }

  /** Fit in the uncovered canvas: annotation meshes can be in-frustum but behind the HUD. */
  private framingViewport(): { widthFraction: number; heightFraction: number } {
    const bounds = this.host().nativeElement.getBoundingClientRect();
    const width = bounds.width || 1;
    const height = bounds.height || 1;
    const stage = this.host().nativeElement.closest('.stage');
    let top = 12, right = 12, bottom = 12;
    const left = 12;
    stage?.querySelectorAll<HTMLElement>('.stage-top > *').forEach(element => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return;
      if (element.matches('.hud-info[open]')) {
        right = Math.max(right, bounds.right - box.left + 12);
      } else {
        top = Math.max(top, box.bottom - bounds.top + 12);
      }
    });
    const footer = stage?.querySelector('.stage-bottom')?.getBoundingClientRect();
    if (footer?.height) bottom = Math.max(bottom, bounds.bottom - footer.top + 12);
    const dock = stage?.querySelector('.hud-dock')?.getBoundingClientRect();
    if (dock?.width) right = Math.max(right, bounds.right - dock.left + 12);
    // Keep a usable view even when a transient panel fills a very small viewport.
    right = Math.min(right, width * 0.45);
    top = Math.min(top, height * 0.4);
    bottom = Math.min(bottom, height * 0.2);
    this.camera.setViewOffset(width, height, (right - left) / 2, (bottom - top) / 2, width, height);
    return { widthFraction: Math.max(0.1, (width - left - right) / width),
      heightFraction: Math.max(0.1, (height - top - bottom) / height) };
  }

  /** The view dock. Frames the whole hall, the same way a newly opened hall is framed. */
  private applyView(command: ViewCommand, hall: Hall): void {
    const rect = this.planRect(hall);

    if (command.kind === 'top') {
      const cx = (rect.minX + rect.maxX) / 2;
      const cz = (rect.minZ + rect.maxZ) / 2;
      this.controls.target.set(cx, 0, cz);
      // Not exactly overhead: straight down leaves the camera's up vector undefined and
      // OrbitControls flips the view on the next drag.
      this.camera.position.set(cx, this.frameDistance(rect, 0.95, false), cz + 0.01);
      this.controls.update();
      return;
    }

    this.focusOn({ rect, seq: command.seq }, command.kind === 'fit' ? 0.95 : 0.75);
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

      object.update(stall, this.selectedStallIds().includes(key) || String(selectedStallId) === key);
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

    if ((this.mode() === 'draw' || this.mode() === 'zone')) {
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

    if (event.button !== 0) return;
    const hit = this.pickStall(event);
    this.pointerDownHit = hit !== null;
    if (!hit) return;
    if(event.shiftKey || event.ctrlKey || event.metaKey) { this.toggleStall.emit(hit.stall.id); return; }

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

    this.hideTooltip();
    this.updateCursor();
    this.selectStall.emit(hit.stall.id);
    this.dragState.emit(true);
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.updateCursor(event);
    if ((this.mode() === 'draw' || this.mode() === 'zone')) {
      const point = this.intersectDragPlane(event);
      if (!point) return;
      if (this.drawPointerId === event.pointerId) {
        this.draftMove.emit({ x: point.x, z: point.z });
      } else if (this.drawPointerId === null && event.buttons === 0) {
        this.draftHover.emit({ x: point.x, z: point.z });
      }
      return;
    }

    if (!this.drag) {
      if (event.buttons === 0) this.updateTooltip(event);
      return;
    }

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
      if(event.type!=='pointercancel') this.draftEnd.emit();
      else this.draftCancel.emit();
      this.renderer.domElement.releasePointerCapture?.(event.pointerId);
      return;
    }

    if (!this.drag || this.drag.pointerId !== event.pointerId) return;

    const { id, moved, pointerId, side, wasSelected } = this.drag;
    this.drag = null;
    this.dragState.emit(false);

    if (!moved && event.type !== 'pointercancel') {
      // A click on a wall of an already-selected stall changes its open side
      // instead of re-selecting. First clicks and clicks on the floor,
      // markers or outline still only select.
      if (side && wasSelected && this.selectedStallIds().length <= 1) {
        this.openSideChange.emit({ id, side });
      } else {
        this.selectStall.emit(id);
      }
    }

    this.renderer.domElement.releasePointerCapture?.(pointerId);
    this.updateCursor(event.type === 'pointercancel' ? undefined : event);
  };

  /** Clicking empty space clears the selection. React's `onPointerMissed`. */
  private readonly onClick = (): void => {
    if (this.pointerDownHit) return;
    this.selectStall.emit(null);
  };

  private readonly onPointerLeave = (): void => {
    this.hideTooltip();
    this.updateCursor();
    if ((this.mode() === 'draw' || this.mode() === 'zone') && this.drawPointerId === null) this.draftLeave.emit();
  };

  /** Three.js owns this canvas, so cursor styles must be applied directly to it. */
  private updateCursor(event?: PointerEvent): void {
    this.renderer.domElement.style.cursor = this.drag ? 'grabbing'
      : (this.mode() === 'draw' || this.mode() === 'zone') ? 'crosshair'
      : event && this.pickSuggestion(event) ? 'pointer'
      : event && this.pickStall(event) ? 'grab' : 'default';
  }

  /**
   * The plan's hover text: a rectangle with a `title` (e.g. "Pillar") or a plan zone shows it
   * next to the pointer, as SelfCare's tooltip does. A stall under the pointer wins.
   */
  private updateTooltip(event: PointerEvent): void {
    const tip = this.tooltip().nativeElement;
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.intersectObjects(this.stallGroup.children, true).length) {
      this.hideTooltip();
      return;
    }
    const hit = this.raycaster
      .intersectObjects([...this.blockedAreasGroup.children, ...this.restrictedGroup.children], true)
      .find(h => typeof h.object.userData[UD_TOOLTIP] === 'string');
    if (!hit) {
      this.hideTooltip();
      return;
    }
    const bounds = this.host().nativeElement.getBoundingClientRect();
    tip.textContent = hit.object.userData[UD_TOOLTIP];
    tip.style.left = `${event.clientX - bounds.left + 14}px`;
    tip.style.top = `${event.clientY - bounds.top + 14}px`;
    tip.hidden = false;
  }

  private hideTooltip(): void {
    const tip = this.tooltip?.()?.nativeElement;
    if (tip) tip.hidden = true;
  }

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

    const { clientWidth, clientHeight } = this.host().nativeElement;

    this.renderer.render(this.scene, this.camera);

    const showLabels = this.showLabels();
    for (const object of this.stallObjects.values()) {
      object.projectLabels(this.camera, clientWidth, clientHeight, showLabels);
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
    this.camera.clearViewOffset();
    this.framingViewport();
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
      this.markerGroup,
      this.amenityGroup
    ]) {
      disposeLayer(layer);
    }
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}

/** Free one layer: sprite canvas textures first, then every geometry and material. */
/** A hall without a traced floor or outline: its rectangle (or circle) floor and border. */
function buildPlainFloor(width: number, length: number, shape: Hall['shape']): THREE.Group {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.78 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  if (shape === 'CIRCLE') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0, width / 2 - 0.06), width / 2, 96),
      new THREE.MeshBasicMaterial({ color: '#475569', side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    group.add(ring);
  } else {
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 0.08, length + 0.08),
      new THREE.MeshBasicMaterial({ color: '#334155', wireframe: true })
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = 0.02;
    group.add(border);
  }
  return group;
}

function disposeLayer(group: THREE.Group): void {
  disposeSpriteTextures(group);
  // Canvas textures of the flat plan annotations live on meshes, not sprites.
  group.traverse(child => {
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (material && !Array.isArray(material) && !(child instanceof THREE.Sprite)) material.map?.dispose();
  });
  disposeChildren(group);
}
