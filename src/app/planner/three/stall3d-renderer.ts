import * as THREE from 'three';

import { GateSide, Stall } from '../models/stall.model';
import { num, validGate } from '../geometry/planner-geometry';
import { interiorPoint, isCustomStall, stallSizeText } from '../geometry/footprint-view';
import type { Point } from '../geometry/placement-rules';

/**
 * Renders one stall. Ported from the React `Stall3D` component
 * (App.js:119-365).
 *
 * The two floating labels were drei `<Html>` elements. There is no Angular
 * equivalent, so they are plain DOM nodes in an overlay that this class
 * projects onto the screen every frame - `projectLabel()` reproduces drei's
 * `distanceFactor` scaling formula so the labels shrink with distance exactly
 * as they did in React.
 */
export class StallObject {
  readonly group = new THREE.Group();

  /** Meshes the raycaster may hit to start a drag. */
  readonly pickTargets: THREE.Object3D[] = [];

  private readonly body = new THREE.Group();
  private readonly nameAnchor = new THREE.Object3D();
  private readonly openAnchor = new THREE.Object3D();
  private readonly nameEl: HTMLDivElement;
  private readonly openEl: HTMLDivElement;

  /** Rebuild key: geometry only changes when one of these values changes. */
  private signature = '';
  private selected = false;

  constructor(
    private stall: Stall,
    private readonly overlay: HTMLElement
  ) {
    this.group.add(this.body, this.nameAnchor, this.openAnchor);
    this.group.userData['stallId'] = stall.id;

    this.nameEl = createLabel();
    this.openEl = createLabel();
    this.overlay.appendChild(this.nameEl);
    this.overlay.appendChild(this.openEl);

    this.update(stall, false);
  }

  get id(): string | number {
    return this.stall.id;
  }

  update(stall: Stall, selected: boolean): void {
    this.stall = stall;
    this.group.userData['stallId'] = stall.id;
    // Identifiable object: what this mesh group is, for picking, debugging and tooling.
    this.group.userData['type'] = 'stall';
    this.group.userData['stallNumber'] = stall.stallNumber;
    this.group.userData['stallType'] = stall.stallTypeId;
    this.group.userData['width'] = stall.width;
    this.group.userData['height'] = stall.length;
    this.group.userData['status'] = stall.status;
    this.group.position.set(stall.posX, 0.08, stall.posZ);
    this.group.rotation.y = -(stall.rotation ?? 0) * Math.PI / 180;

    const signature = [
      num(stall.width, 5),
      num(stall.length, 5),
      num(stall.height, 4),
      this.openSidesOf(stall).join(','),
      stall.color || '#3498db',
      stall.status,
      selected,
      JSON.stringify(stall.footprint ?? null),
      (stall.openEdges ?? []).join(',')
    ].join('|');

    if (signature !== this.signature) {
      this.signature = signature;
      this.selected = selected;
      this.rebuild();
    }

    // Stall number (persisted identity, "NEW" until the first save) and size on two lines.
    const cancelled = stall.status === 'CANCELLED';
    const number = stall.stallNumber ?? 'NEW';
    const identity = stall.name && stall.name !== number ? `${number} · ${stall.name}` : number;
    this.nameEl.textContent = cancelled
      ? `${number}
CANCELLED`
      : `${identity}
${stallSizeText(stall)}${stall.status === 'BOOKED' ? ' · BOOKED' : ''}`;
    this.nameEl.style.whiteSpace = 'pre';
    this.nameEl.style.textAlign = 'center';
    this.nameEl.style.background = cancelled
      ? 'rgba(100,116,139,.85)'
      : selected
        ? '#2563eb'
        : 'rgba(15,23,42,.88)';
    this.nameEl.style.color = '#fff';
    this.nameEl.style.padding = '4px 7px';
    this.nameEl.style.borderRadius = '5px';
    this.nameEl.style.fontSize = '10px';
    this.nameEl.style.fontWeight = '700';
    this.nameEl.style.boxShadow = '0 2px 7px rgba(0,0,0,.25)';

    const open = this.openSidesOf(stall);
    this.openEl.textContent = `OPEN: ${open.join(', ')}`;
    this.openEl.style.color = '#052e16';
    this.openEl.style.fontSize = '10px';
    this.openEl.style.fontWeight = '900';
    this.openEl.style.background = '#86efac';
    this.openEl.style.border = '1px solid #16a34a';
    this.openEl.style.padding = '3px 6px';
    this.openEl.style.borderRadius = '4px';
  }

  /**
   * Position both labels for the current camera. With `visible` false they are hidden, except
   * on the selected stall.
   */
  projectLabels(camera: THREE.PerspectiveCamera, width: number, height: number, visible = true): void {
    if (!visible && !this.selected) {
      this.nameEl.style.display = 'none';
      this.openEl.style.display = 'none';
      return;
    }
    projectLabel(this.nameEl, this.nameAnchor, camera, width, height, 10);
    if (this.stall.status === 'CANCELLED') {
      // A cancelled stall has no walls, so no open side to label.
      this.openEl.style.display = 'none';
    } else {
      projectLabel(this.openEl, this.openAnchor, camera, width, height, 12);
    }
  }

  dispose(): void {
    disposeChildren(this.body);
    this.nameEl.remove();
    this.openEl.remove();
    this.group.removeFromParent();
  }

  /**
   * Rebuild the stall body.
   *
   * Every side in `openSides` has its wall NOT rendered and gets a green OPEN
   * marker: FRONT = +Z open, BACK = -Z open, LEFT = -X open, RIGHT = +X open.
   */
  private rebuild(): void {
    disposeChildren(this.body);
    this.pickTargets.length = 0;

    if (this.stall.status === 'CANCELLED') {
      this.rebuildCancelled();
      return;
    }
    if (isCustomStall(this.stall)) {
      this.rebuildCustom();
      return;
    }

    const stall = this.stall;
    const open = this.openSidesOf(stall);
    const first = open[0];
    const w = Math.max(0.2, num(stall.width, 5));
    const l = Math.max(0.2, num(stall.length, 5));
    const h = Math.max(0.2, num(stall.height, 4));

    // Wall thickness.
    const wall = Math.min(0.22, Math.max(0.1, Math.min(w, l) * 0.035));

    // Stall floor.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.08, l),
      new THREE.MeshStandardMaterial({ color: '#e2e8f0' })
    );
    floor.position.set(0, 0.04, 0);
    floor.receiveShadow = true;
    this.addPart(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: stall.color || '#3498db',
      roughness: 0.42,
      metalness: 0.05
    });

    if (!open.includes('FRONT')) this.addWall(new THREE.BoxGeometry(w, h, wall), wallMaterial, 0, h / 2, l / 2, 'FRONT');
    if (!open.includes('BACK')) this.addWall(new THREE.BoxGeometry(w, h, wall), wallMaterial, 0, h / 2, -l / 2, 'BACK');
    if (!open.includes('LEFT')) this.addWall(new THREE.BoxGeometry(wall, h, l), wallMaterial, -w / 2, h / 2, 0, 'LEFT');
    if (!open.includes('RIGHT')) this.addWall(new THREE.BoxGeometry(wall, h, l), wallMaterial, w / 2, h / 2, 0, 'RIGHT');

    // Clear visual OPEN marker on every open side.
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      side: THREE.DoubleSide
    });

    for (const side of open) {
      if (side === 'FRONT') {
        this.addMarker(Math.max(1, w * 0.55), markerMaterial, [0, 0.105, l / 2 + 0.16], [-Math.PI / 2, 0, 0]);
      } else if (side === 'BACK') {
        this.addMarker(Math.max(1, w * 0.55), markerMaterial, [0, 0.105, -l / 2 - 0.16], [-Math.PI / 2, 0, 0]);
      } else if (side === 'LEFT') {
        this.addMarker(Math.max(1, l * 0.55), markerMaterial, [-w / 2 - 0.16, 0.105, 0], [-Math.PI / 2, 0, Math.PI / 2]);
      } else {
        this.addMarker(Math.max(1, l * 0.55), markerMaterial, [w / 2 + 0.16, 0.105, 0], [-Math.PI / 2, 0, Math.PI / 2]);
      }
    }

    // Selection outline.
    if (this.selected) {
      const outline = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.16, 0.025, l + 0.16),
        new THREE.MeshBasicMaterial({ color: '#2563eb', wireframe: true })
      );
      outline.position.set(0, 0.095, 0);
      this.addPart(outline);
    }

    this.nameAnchor.position.set(0, h + 0.35, 0);
    this.openAnchor.position.set(
      first === 'LEFT' ? -w / 2 - 0.35 : first === 'RIGHT' ? w / 2 + 0.35 : 0,
      0.25,
      first === 'FRONT' ? l / 2 + 0.35 : first === 'BACK' ? -l / 2 - 0.35 : 0
    );
  }

  /**
   * A cancelled stall keeps its number but no longer occupies space: a flat grey footprint with
   * a dashed outline, no walls, so it reads as "was here" and can be built over.
   */
  private rebuildCancelled(): void {
    if (isCustomStall(this.stall)) {
      const poly = this.stall.footprint!;
      const floor = new THREE.Mesh(
        new THREE.ShapeGeometry(shapeOf(poly)),
        new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.35, depthWrite: false })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.03;
      this.addPart(floor);
      const dashed = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(poly.map(p => new THREE.Vector3(p.x, 0.05, p.z))),
        new THREE.LineDashedMaterial({ color: this.selected ? '#2563eb' : '#475569', dashSize: 0.4, gapSize: 0.25 })
      );
      dashed.computeLineDistances();
      this.body.add(dashed);
      const c = interiorPoint(poly);
      this.nameAnchor.position.set(c.x, 0.6, c.z);
      this.openAnchor.position.set(c.x, 0.25, c.z);
      return;
    }
    const w = Math.max(0.2, num(this.stall.width, 5));
    const l = Math.max(0.2, num(this.stall.length, 5));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.35, depthWrite: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.03, 0);
    this.addPart(floor);

    const points = [
      new THREE.Vector3(-w / 2, 0.05, -l / 2),
      new THREE.Vector3(w / 2, 0.05, -l / 2),
      new THREE.Vector3(w / 2, 0.05, l / 2),
      new THREE.Vector3(-w / 2, 0.05, l / 2)
    ];
    const dashed = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({ color: this.selected ? '#2563eb' : '#475569', dashSize: 0.4, gapSize: 0.25 })
    );
    dashed.computeLineDistances();
    this.body.add(dashed);

    this.nameAnchor.position.set(0, 0.6, 0);
    this.openAnchor.position.set(0, 0.25, 0);
  }

  /**
   * A custom (polygon, e.g. L-shaped) stall: the floor is the outline itself, so its notch stays
   * empty and un-pickable; each closed edge gets a wall, each open edge a green marker outside it.
   */
  private rebuildCustom(): void {
    const stall = this.stall;
    const poly = stall.footprint!;
    const open = new Set(stall.openEdges ?? []);
    const h = Math.max(0.2, num(stall.height, 4));
    const wall = 0.15;

    const floor = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shapeOf(poly), { depth: 0.08, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: '#e2e8f0' })
    );
    // Shape (x, y) with y = -z, laid flat: local (x, 0..0.08, z).
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.addPart(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: stall.color || '#3498db', roughness: 0.42, metalness: 0.05 });
    const markerMaterial = new THREE.MeshBasicMaterial({ color: '#22c55e', side: THREE.DoubleSide });
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) return;
      // Clockwise outline: outward normal (dz, -dx) / len.
      const n = { x: dz / len, z: -dx / len };
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (open.has(i)) {
        const marker = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.5, len * 0.55), 0.22), markerMaterial);
        marker.rotation.set(-Math.PI / 2, 0, Math.atan2(-dz, dx));
        marker.position.set(mid.x + n.x * 0.16, 0.105, mid.z + n.z * 0.16);
        this.addPart(marker);
        return;
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + wall, h, wall), wallMaterial);
      // Inside the outline, so the wall never pokes into a neighbour or the notch.
      mesh.position.set(mid.x - (n.x * wall) / 2, h / 2, mid.z - (n.z * wall) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData['edge'] = i;
      this.addPart(mesh);
    });

    if (this.selected) {
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(poly.map(p => new THREE.Vector3(p.x, 0.12, p.z))),
        new THREE.LineBasicMaterial({ color: '#2563eb' })
      );
      this.body.add(outline);
    }

    const c = interiorPoint(poly);
    this.nameAnchor.position.set(c.x, h + 0.35, c.z);
    const first = [...open][0];
    if (first !== undefined) {
      const a = poly[first];
      const b = poly[(first + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      this.openAnchor.position.set((a.x + b.x) / 2 + ((b.z - a.z) / len) * 0.35, 0.25, (a.z + b.z) / 2 - ((b.x - a.x) / len) * 0.35);
    } else {
      this.openAnchor.position.set(c.x, 0.25, c.z);
    }
  }

  /** Open sides of a stall, deriving from gateSide for legacy single-side data. */
  private openSidesOf(stall: Stall): GateSide[] {
    return stall.openSides?.length ? stall.openSides : [validGate(stall.gateSide)];
  }

  private addWall(
    geometry: THREE.BoxGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    side: GateSide
  ): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Lets a wall click in the 3D view set the stall's open side. Floor,
    // markers and the selection outline carry no tag.
    mesh.userData['side'] = side;
    this.addPart(mesh);
  }

  private addMarker(
    size: number,
    material: THREE.Material,
    position: [number, number, number],
    rotation: [number, number, number]
  ): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, 0.22), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    this.addPart(mesh);
  }

  private addPart(mesh: THREE.Mesh): void {
    this.body.add(mesh);
    this.pickTargets.push(mesh);
  }
}

/** Outline as a THREE.Shape in (x, -z), to be laid flat with rotation.x = -PI/2. */
function shapeOf(poly: Point[]): THREE.Shape {
  return new THREE.Shape(poly.map(p => new THREE.Vector2(p.x, -p.z)));
}

function createLabel(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.whiteSpace = 'nowrap';
  el.style.pointerEvents = 'none';
  el.style.willChange = 'transform';
  return el;
}

/**
 * drei scales an `<Html distanceFactor={d}>` by `d / (2 * tan(fov/2) * dist)`.
 * Reproducing that formula keeps label sizes identical to the React build.
 */
const worldPosition = new THREE.Vector3();
const cameraPosition = new THREE.Vector3();

function projectLabel(
  el: HTMLElement,
  anchor: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  distanceFactor: number
): void {
  anchor.getWorldPosition(worldPosition);
  cameraPosition.setFromMatrixPosition(camera.matrixWorld);

  const distance = worldPosition.distanceTo(cameraPosition);
  const ndc = worldPosition.clone().project(camera);

  if (ndc.z > 1) {
    el.style.display = 'none';
    return;
  }

  const vFov = (camera.fov * Math.PI) / 180;
  // Keep identifiers readable when the whole hall is in view.
  const scale = Math.max(0.85, Math.min(1.25, distanceFactor / (2 * Math.tan(vFov / 2) * distance)));
  const x = (ndc.x * 0.5 + 0.5) * width;
  const y = (-ndc.y * 0.5 + 0.5) * height;

  el.style.display = 'block';
  el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
}

/** Dispose every geometry/material below `root` and detach the children. */
export function disposeChildren(root: THREE.Object3D): void {
  const seenMaterials = new Set<THREE.Material>();

  root.traverse(child => {
    const mesh = child as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();

    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach(m => seenMaterials.add(m));
    } else if (material) {
      seenMaterials.add(material);
    }
  });

  seenMaterials.forEach(m => m.dispose());
  root.clear();
}
