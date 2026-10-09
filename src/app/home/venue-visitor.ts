import * as T from 'three';
import { createVisitorAvatar } from './visitor-avatar';
import { createVisitorPortals } from './visitor-portals';
import { VisitorNavigation, VisitorPortal, campusWalkable, inDoorway, portalCoordinates, slideVisitor } from './visitor-navigation';
import { InteriorHall, InteriorObstacle, hallToWorld, worldToHall, walkable } from './venue-interiors';

export interface VisitorState {
  active: boolean;
  location: string;
  hall: string;
  destination: string;
  distance: number;
  bearing: number;
  fast: boolean;
  transitioning: boolean;
  hint: string;
  position: [number, number, number];
  heading: number;
  entrance?: [number, number, number];
}
export const INITIAL_VISITOR_STATE: VisitorState = {
  active: false, location: 'Gate 6', hall: '', destination: '', distance: 0, bearing: 0,
  fast: false, transitioning: false, hint: '', position: [0, 0, 0], heading: 0,
};
export type VisitorInput = 'forward' | 'backward' | 'left' | 'right';

export function createVenueVisitor(options: {
  root: T.Group; scene: T.Scene; camera: T.PerspectiveCamera; canvas: HTMLCanvasElement;
  interiorLayer?: T.Group;
  navigation: VisitorNavigation; halls: InteriorHall[]; obstacles: Map<string, InteriorObstacle[]>;
  signal: AbortSignal; invalidate: () => void; reducedMotion: () => boolean;
  showInterior: (id?: string) => void; changed: (state: VisitorState) => void; exit: () => void;
}) {
  const { root, scene, camera, canvas, navigation: nav, signal, invalidate } = options;
  const avatar = createVisitorAvatar(); scene.add(avatar.root); avatar.root.visible = false;
  const doors = createVisitorPortals(root, nav.portals, scene);
  const position = nav.spawn.clone(), target = new T.Vector3(), desired = new T.Vector3();
  const ray = new T.Raycaster(), blockers: T.Object3D[] = [];
  root.traverse(o => { if (o instanceof T.Mesh) blockers.push(o); });
  options.interiorLayer?.traverse(o => { if (o instanceof T.Mesh) blockers.push(o); });
  const keys = new Set<string>(), touches = new Set<VisitorInput>();
  let active = false, hall: InteriorHall | undefined, portal: VisitorPortal | undefined;
  let yaw = nav.heading, avatarYaw = yaw, pitch = .17, distance = 4.7, fast = false;
  let last = 0, lastState = 0, lastPacket = '', targetId = nav.portals[0]?.hall.id ?? '';
  let pointer: { id: number; x: number; y: number } | undefined;
  let floorChange: { start: number; hall: InteriorHall; position: T.Vector3 } | undefined;
  let savedCamera: { position: T.Vector3; quaternion: T.Quaternion; fov: number; near: number } | undefined;
  let actionHint = '';

  function packet(): VisitorState {
    const destination = nav.portals.find(p => p.hall.id === targetId);
    const delta = destination?.position.clone().sub(position);
    const near = nav.portals.find(p => {
      const relative = portalCoordinates(p, position);
      return Math.abs(relative.across) < 7 && relative.along > -8 && relative.along < p.approach + 8;
    });
    const heading = delta ? Math.atan2(delta.x, delta.z) : yaw;
    const atGate = position.distanceTo(nav.spawn) < 30;
    return { active, location: hall?.label ?? (atGate ? 'Gate 6 · Arrival' : 'Campus'), hall: hall?.id ?? '',
      destination: targetId, distance: delta ? Math.round(Math.hypot(delta.x, delta.z)) : 0,
      bearing: Math.atan2(Math.sin(yaw - heading), Math.cos(yaw - heading)) * 180 / Math.PI,
      fast, transitioning: !!floorChange, position: position.toArray(), heading: yaw,
      entrance: destination?.position.toArray(),
      hint: floorChange ? 'Changing floor…' : actionHint || (hall ? 'Explore inside. Walk back through the entrance to return to campus.'
        : near ? `Walk through the doors to enter ${near.hall.level ? 'the Convention Centre' : near.hall.label}.`
        : 'Follow the entrance signs. W A S D to walk; drag to look around.') };
  }
  function publish(force = false) {
    const state = packet(), key = JSON.stringify(state);
    if (force || key !== lastPacket) { options.changed(state); lastPacket = key; }
  }
  function clearInput() { keys.clear(); touches.clear(); pointer = undefined; last = 0; }
  function setHall(next?: InteriorHall) {
    if (hall === next) return;
    hall = next;
    portal = nav.portals.find(p => p.hall.id === (next?.level ? 'cc-level1' : next?.id));
    options.showInterior(next?.id);
    actionHint = ''; publish();
  }
  function allowed(p: T.Vector3) {
    if (!hall) return campusWalkable(nav, p);
    // Only the ground-floor entrance connects to the outdoor campus.
    if ((!hall.level || hall.level === 1) && portal && inDoorway(portal, p)) {
      const signed = portalCoordinates(portal, p).along;
      if (signed > -2.2) return campusWalkable(nav, p);
    }
    const local = worldToHall(hall, p);
    return walkable(hall, options.obstacles.get(hall.id) ?? [], local.x, local.z);
  }
  function updateLocation() {
    if (!hall) {
      for (const door of nav.portals) {
        const p = portalCoordinates(door, position);
        if (Math.abs(p.across) < door.width / 2 && p.along < -2.2 && p.along > -8) {
          const local = worldToHall(door.hall, position);
          if (walkable(door.hall, options.obstacles.get(door.hall.id) ?? [], local.x, local.z)) setHall(door.hall);
          break;
        }
      }
    } else if ((!hall.level || hall.level === 1) && portal) {
      const p = portalCoordinates(portal, position);
      if (p.along > 1 && Math.abs(p.across) < portal.width / 2) setHall();
    }
    if (hall) {
      const local = worldToHall(hall, position);
      position.y = hall.center.y + (hall.elevation?.(local.x, local.z) ?? 0);
    } else {
      position.y = position.distanceTo(nav.spawn) < 34 ? .35 : .24;
      const ramp = nav.portals.find(p => p.hall.level && inDoorway(p, position));
      if (ramp) position.y = T.MathUtils.lerp(ramp.position.y, .24,
        T.MathUtils.clamp(portalCoordinates(ramp, position).along / ramp.approach, 0, 1));
    }
  }
  function updateCamera(dt: number, immediate = false) {
    target.copy(position).y += 1.25;
    desired.copy(target).add(new T.Vector3(-Math.sin(yaw) * distance, 1.05 + pitch * distance, -Math.cos(yaw) * distance));
    const direction = desired.clone().sub(target), fullDistance = direction.length();
    ray.set(target, direction.normalize()); ray.far = fullDistance;
    const hits = ray.intersectObjects(blockers.filter(o => {
      for (let node: T.Object3D | null = o; node; node = node.parent) if (!node.visible) return false;
      return true;
    }), false);
    const hit = hits.find(h => {
      const door = nav.portals.find(p => inDoorway(p, h.point, .15) && h.point.y > p.position.y && h.point.y < p.position.y + 3.7);
      return !door && h.distance > .15;
    });
    if (hit) desired.copy(target).addScaledVector(direction, Math.max(.35, hit.distance - .3));
    if (immediate || options.reducedMotion()) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-10 * dt));
    camera.lookAt(target);
  }
  function start() {
    if (active) return;
    savedCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, near: camera.near };
    active = true; hall = undefined; portal = undefined; floorChange = undefined;
    position.copy(nav.spawn); yaw = nav.heading; avatarYaw = yaw; fast = false; pitch = .17;
    camera.near = .08; camera.fov = 58; camera.updateProjectionMatrix();
    avatar.root.visible = true; avatar.root.position.copy(position); avatar.root.rotation.y = avatarYaw;
    doors.setEnabled(true); clearInput(); updateCamera(0, true);
    canvas.focus({ preventScroll: true }); publish(true); invalidate();
  }
  function stop() {
    if (!active) return;
    active = false; floorChange = undefined; setHall(); clearInput(); doors.setEnabled(false);
    avatar.root.visible = false;
    if (savedCamera) {
      camera.position.copy(savedCamera.position); camera.quaternion.copy(savedCamera.quaternion);
      camera.fov = savedCamera.fov; camera.near = savedCamera.near; camera.updateProjectionMatrix();
    }
    publish(true); invalidate();
  }
  function keyboard(e: KeyboardEvent, down: boolean) {
    const key = e.key.toLowerCase();
    if (!down) keys.delete(key);
    if (!active) return;
    const el = e.composedPath()[0];
    if (el instanceof HTMLElement && el.closest('dialog[open]')) return;
    if (down && key === 'escape') { e.preventDefault(); options.exit(); return; }
    if (el instanceof HTMLElement && el.closest('button,input,select,textarea,[contenteditable="true"]')) return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
      e.preventDefault(); if (down) keys.add(key); invalidate();
    }
  }
  window.addEventListener('keydown', e => keyboard(e, true), { signal });
  window.addEventListener('keyup', e => keyboard(e, false), { signal });
  window.addEventListener('blur', clearInput, { signal });
  canvas.addEventListener('blur', () => { keys.clear(); pointer = undefined; }, { signal });
  document.addEventListener('visibilitychange', clearInput, { signal });
  canvas.addEventListener('pointerdown', e => {
    if (!active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true });
  }, { signal });
  canvas.addEventListener('pointermove', e => {
    if (!active || !pointer || pointer.id !== e.pointerId) return;
    yaw -= (e.clientX - pointer.x) * .004;
    pitch = T.MathUtils.clamp(pitch + (e.clientY - pointer.y) * .003, -.12, .7);
    pointer.x = e.clientX; pointer.y = e.clientY; invalidate();
  }, { signal });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    canvas.addEventListener(event, () => { pointer = undefined; }, { signal });
  canvas.addEventListener('wheel', e => {
    if (!active) return; e.preventDefault(); distance = T.MathUtils.clamp(distance + e.deltaY * .006, 2.5, 8); invalidate();
  }, { signal, passive: false });
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D Bharat Mandapam. In visitor mode, W A S D to walk, arrow keys to turn, drag to look, Shift to walk faster, Escape to exit.');
  return {
    start, stop,
    get active() { return active; },
    get position() { return position; },
    get heading() { return yaw; },
    input(input: VisitorInput, down: boolean) {
      if (!active) return;
      if (down) touches.add(input); else touches.delete(input); invalidate();
    },
    step(input: VisitorInput) {
      if (!active || floorChange) return;
      if (input === 'left' || input === 'right') yaw += input === 'left' ? .25 : -.25;
      else { const d = input === 'forward' ? 1 : -1; slideVisitor(position, Math.sin(yaw) * d, Math.cos(yaw) * d, allowed); updateLocation(); }
      invalidate();
    },
    faster() { fast = !fast; publish(); canvas.focus({ preventScroll: true }); invalidate(); },
    destination(id: string) { targetId = id; actionHint = ''; publish(); canvas.focus({ preventScroll: true }); invalidate(); },
    restart() {
      if (!active) return;
      clearInput(); floorChange = undefined; setHall(); position.copy(nav.spawn); yaw = avatarYaw = nav.heading;
      actionHint = ''; updateCamera(0, true); publish(); canvas.focus({ preventScroll: true }); invalidate();
    },
    floor(level: number) {
      if (!active || !hall?.level || floorChange) return;
      const next = options.halls.find(h => h.level === level); if (!next || next === hall) return;
      let p = next.entrance;
      if (!walkable(next, options.obstacles.get(next.id) ?? [], ...p)) p = next.route?.find(p => walkable(next, options.obstacles.get(next.id) ?? [], ...p)) ?? p;
      if (!walkable(next, options.obstacles.get(next.id) ?? [], ...p)) return;
      clearInput(); floorChange = { start: performance.now(), hall: next, position: hallToWorld(next, p[0], next.elevation?.(...p) ?? 0, p[1]) };
      publish(); invalidate();
    },
    update(now: number) {
      if (!active) return false;
      const dt = last ? Math.min(.05, Math.max(0, (now - last) / 1000)) : 0; last = now;
      if (floorChange) {
        if (now - floorChange.start > (options.reducedMotion() ? 0 : 300)) {
          position.copy(floorChange.position); setHall(floorChange.hall);
          yaw = Math.PI - floorChange.hall.angle; avatarYaw = yaw;
          floorChange = undefined; updateCamera(0, true); canvas.focus({ preventScroll: true }); publish();
        }
      }
      const turn = Number(keys.has('arrowleft') || touches.has('left')) - Number(keys.has('arrowright') || touches.has('right'));
      yaw += turn * dt * 1.65;
      const forward = Number(keys.has('w') || keys.has('arrowup') || touches.has('forward')) - Number(keys.has('s') || keys.has('arrowdown') || touches.has('backward'));
      const side = Number(keys.has('d')) - Number(keys.has('a'));
      const normal = Math.max(1, Math.hypot(forward, side)), speed = fast || keys.has('shift') ? 5.5 : 2.6;
      const dx = (Math.sin(yaw) * forward - Math.cos(yaw) * side) * speed * dt / normal;
      const dz = (Math.cos(yaw) * forward + Math.sin(yaw) * side) * speed * dt / normal;
      const travelled = floorChange ? 0 : slideVisitor(position, dx, dz, allowed);
      if (travelled > .0001) {
        const aim = Math.atan2(dx, dz);
        avatarYaw += Math.atan2(Math.sin(aim - avatarYaw), Math.cos(aim - avatarYaw)) * Math.min(1, dt * 12);
      }
      updateLocation();
      avatar.root.position.copy(position); avatar.root.rotation.y = avatarYaw;
      avatar.update(dt, dt ? travelled / dt : 0, options.reducedMotion());
      doors.update(position, dt, hall?.id); updateCamera(dt);
      if (now - lastState > 180) { publish(); lastState = now; }
      // Follow-camera and sliding-door settling are bounded to active visitor mode.
      return true;
    },
    dispose() { stop(); avatar.dispose(); doors.dispose(); },
  };
}
