import * as T from 'three';
import { createVisitorAvatar } from './visitor-avatar';
import { createVisitorPortals } from './visitor-portals';
import { VisitorNavigation, VisitorPortal, campusWalkable, inDoorway, portalCoordinates, slideVisitor, visitorHallWalkable, visitorGroundHeight } from './visitor-navigation';
import { VISITOR_RADIUS } from './visitor-collision';
import { InteriorHall, InteriorObstacle, hallToWorld } from './venue-interiors';
import { findVisitorPath, planVisitorRoute, walkableRoute } from './visitor-routing';

export interface VisitorState {
  active: boolean;
  location: string;
  hall: string;
  destination: string;
  distance: number;
  bearing: number;
  fast: boolean;
  transitioning: boolean;
  autoWalking: boolean;
  jumping: boolean;
  nearbyEntrance?: { id: string; label: string };
  hint: string;
  position: [number, number, number];
  heading: number;
  entrance?: [number, number, number];
}
export const INITIAL_VISITOR_STATE: VisitorState = {
  active: false, location: 'Gate 9', hall: '', destination: '', distance: 0, bearing: 0,
  fast: false, transitioning: false, autoWalking: false, jumping: false, hint: '', position: [0, 0, 0], heading: 0,
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
  const avatar = createVisitorAvatar({ invalidate, failed: () => {
    actionHint = 'Your avatar could not load. Exit and re-enter to retry; the default visitor is available.';
    publish(); invalidate();
  } }); scene.add(avatar.root); avatar.root.visible = false;
  const doors = createVisitorPortals(root, nav.portals, scene, options.interiorLayer);
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
  let autoRoute: T.Vector3[] = [], waypoint = 0, autoSpeed = 0;
  /** Set while walking a Directions route (followRoute): the place it leads to. */
  let routeLabel = '';
  let jumpOffset = 0, jumpVelocity = 0, jumping = false;
  const jumpGravity = 20;

  function nearbyEntrance() {
    if (!active || hall || floorChange) return;
    return nav.portals.filter(p => {
      const relative = portalCoordinates(p, position);
      return Math.abs(relative.across) < p.width / 2 + 3 && relative.along > -2.2 && relative.along < p.approach + 4;
    }).sort((a, b) => position.distanceToSquared(a.position) - position.distanceToSquared(b.position))[0];
  }

  function packet(): VisitorState {
    const destination = nav.portals.find(p => p.hall.id === targetId);
    const delta = destination?.position.clone().sub(position);
    const near = nearbyEntrance();
    const heading = delta ? Math.atan2(delta.x, delta.z) : yaw;
    const atGate = position.distanceTo(nav.spawn) < 30;
    return { active, location: hall?.label ?? (atGate ? `${nav.arrivalLabel ?? 'Gate 6'} · Arrival` : 'Campus'), hall: hall?.id ?? '',
      destination: targetId, distance: delta ? Math.round(Math.hypot(delta.x, delta.z)) : 0,
      bearing: Math.atan2(Math.sin(yaw - heading), Math.cos(yaw - heading)) * 180 / Math.PI,
      fast, transitioning: !!floorChange, autoWalking: autoRoute.length > 0, jumping, position: position.toArray(), heading: yaw,
      nearbyEntrance: near ? { id: near.hall.id, label: near.hall.level ? 'Convention Centre' : near.hall.label } : undefined,
      entrance: destination?.position.toArray(),
      hint: floorChange ? 'Changing floor…' : autoRoute.length ? `Moving to ${routeLabel || destination?.hall.label}. Use Stop or movement controls to take over.` : actionHint || (hall ? 'Explore inside. Walk back through the entrance to return to campus.'
        : near ? ''
        : 'W A S D to walk, Space to jump; drag to look around.') };
  }
  function publish(force = false) {
    const state = packet(), key = JSON.stringify(state);
    if (force || key !== lastPacket) { options.changed(state); lastPacket = key; }
  }
  function clearInput() { keys.clear(); touches.clear(); pointer = undefined; last = 0; }
  function cancelAutoWalk(message = 'Auto-walk stopped. You can move manually or select Go to hall again.') {
    if (!autoRoute.length) return;
    autoRoute = []; waypoint = 0; routeLabel = ''; actionHint = message; publish(); invalidate();
  }
  /**
   * Walk a Directions route (world x/z, start first) from its start. Inside the campus it is first made walkable
   * (walkableRoute: round the buildings the traced walkways cut through, in at the destination's doorway); out of
   * the gates and along the road footpaths there is no collision data, so the drawn line is followed as it is and
   * the campus collision is not applied while walking it.
   */
  function followRoute(points: { x: number; z: number }[], label: string, destinationId = '') {
    if (points.length < 2 || floorChange || jumping) return;
    if (!active) start();
    cancelAutoWalk(''); clearInput(); setHall();
    const door = nav.portals.find(p => (p.hall.level ? 'cc' : p.hall.id) === destinationId);
    const path = walkableRoute(nav, options.obstacles, points.map(p => new T.Vector3(p.x, 0, p.z)), door);
    if (!path) { actionHint = 'No clear route there. Move to an open area and try again.'; publish(); invalidate(); return; }
    path.forEach(p => p.y = visitorGroundHeight(nav, p));
    position.copy(path[0]); yaw = avatarYaw = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
    autoRoute = path; waypoint = 1; autoSpeed = 0; routeLabel = label; actionHint = '';
    updateLocation(); updateCamera(0, true); publish(); canvas.focus({ preventScroll: true }); invalidate();
  }
  function goToDestination() {
    if (!active || floorChange || jumping) return;
    cancelAutoWalk(''); clearInput();
    const destination = nav.portals.find(p => p.hall.id === targetId);
    if (!destination) return;
    if (hall?.level && hall.level > 1) {
      actionHint = 'Choose Level 1 before travelling to another hall.';
    } else {
      const path = planVisitorRoute(nav, options.obstacles, hall, position, destination);
      if (!path) actionHint = 'No clear route to this hall. Move to an open area and try again.';
      else if (path.length < 2) actionHint = `You are already inside ${destination.hall.label}.`;
      else { autoRoute = path; waypoint = 1; autoSpeed = 0; actionHint = ''; }
    }
    publish(); canvas.focus({ preventScroll: true }); invalidate();
  }
  function enterNearby() {
    const door = nearbyEntrance();
    if (!door || jumping || autoRoute.length) return;
    const goal = door.position.clone().addScaledVector(door.outward, -4.5);
    const clear = (p: T.Vector3) => campusWalkable(nav, p) ||
      visitorHallWalkable(nav, door.hall, options.obstacles.get(door.hall.id) ?? [], p);
    const path = findVisitorPath(position, goal, nav.bounds, clear, 1);
    if (!path) actionHint = 'The entrance is blocked. Move to a clear spot beside the doorway and try again.';
    else {
      clearInput(); targetId = door.hall.id; autoRoute = path; waypoint = 1; autoSpeed = 0; actionHint = '';
    }
    publish(); canvas.focus({ preventScroll: true }); invalidate();
  }
  function jump() {
    if (!active || floorChange || jumping) return;
    cancelAutoWalk(''); jumping = true; jumpVelocity = 9; actionHint = '';
    publish(); canvas.focus({ preventScroll: true }); invalidate();
  }
  function resetJump() { jumpOffset = 0; jumpVelocity = 0; jumping = false; }
  function updateJump(dt: number) {
    if (!jumping || dt <= 0) return;
    const next = Math.max(0, jumpOffset + jumpVelocity * dt - jumpGravity * dt * dt / 2);
    jumpVelocity -= jumpGravity * dt;
    const start = jumpOffset, steps = Math.max(1, Math.ceil(Math.abs(next - start) / .06));
    const ground = visitorGroundHeight(nav, position, hall), trial = position.clone();
    // Sweep the actual body, so a fast frame cannot put the head through a lintel.
    for (let i = 1; i <= steps; i++) {
      const height = T.MathUtils.lerp(start, next, i / steps);
      trial.y = ground + height;
      if (nav.geometry?.blocked(trial)) { jumpVelocity = Math.min(0, jumpVelocity); break; }
      jumpOffset = height;
    }
    position.y = ground + jumpOffset;
    if (jumpOffset <= .00001 && jumpVelocity <= 0) { resetJump(); publish(); }
  }
  function advanceAutoWalk(dt: number) {
    const goal = autoRoute[autoRoute.length - 1];
    const arrivalSpeed = waypoint === autoRoute.length - 1
      ? Math.max(.8, Math.sqrt(14 * Math.hypot(goal.x - position.x, goal.z - position.z))) : 24;
    // Cover the campus quickly, then approach doorways at walking speed.
    const doorDistance = Math.min(...nav.portals.map(p => Math.hypot(p.position.x - position.x, p.position.z - position.z)));
    const doorSpeed = T.MathUtils.lerp(5.5, 24, T.MathUtils.smoothstep(doorDistance, 6, 32));
    autoSpeed = T.MathUtils.clamp(Math.min(24, arrivalSpeed, doorSpeed), Math.max(0, autoSpeed - 35 * dt), autoSpeed + 80 * dt);
    let remaining = autoSpeed * dt, travelled = 0;
    const trial = position.clone();
    while (autoRoute.length && remaining > .00001) {
      const goal = autoRoute[waypoint], dx = goal.x - position.x, dz = goal.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < .001) {
        if (++waypoint === autoRoute.length) {
          const label = routeLabel || (nav.portals.find(p => p.hall.id === targetId)?.hall.label ?? 'the hall');
          cancelAutoWalk(`Arrived at ${label}. You can explore with the movement controls.`);
        }
        continue;
      }
      const step = Math.min(.12, remaining, distance);
      trial.copy(position); trial.x += dx / distance * step; trial.z += dz / distance * step;
      if (!routeLabel && !allowed(trial)) { cancelAutoWalk('The route is blocked. Move to an open area and try again.'); break; }
      position.copy(trial); updateLocation(); travelled += step; remaining -= step;
    }
    return travelled;
  }
  function setHall(next?: InteriorHall) {
    if (hall === next) return;
    hall = next;
    portal = nav.portals.find(p => p.hall.id === (next?.level ? 'cc-level1' : next?.id));
    options.showInterior(next?.id);
    actionHint = ''; publish();
  }
  function allowed(p: T.Vector3) {
    // Keep ground-route restrictions while airborne, and also check the raised
    // body. Jumping never bypasses walls, guard bodies or a low doorway ceiling.
    if (jumpOffset > 0 && nav.geometry?.blocked(new T.Vector3(p.x, visitorGroundHeight(nav, p, hall) + jumpOffset, p.z))) return false;
    if (!hall) return campusWalkable(nav, p);
    // Only the ground-floor entrance connects to the outdoor campus.
    if ((!hall.level || hall.level === 1) && portal && inDoorway(portal, p, -VISITOR_RADIUS)) {
      const signed = portalCoordinates(portal, p).along;
      if (signed > -2.2) return campusWalkable(nav, p);
    }
    return visitorHallWalkable(nav, hall, options.obstacles.get(hall.id) ?? [], p);
  }
  function updateLocation() {
    if (!hall) {
      for (const door of nav.portals) {
        const p = portalCoordinates(door, position);
        if (Math.abs(p.across) < door.width / 2 - VISITOR_RADIUS && p.along < -2.2 && p.along > -8) {
          if (visitorHallWalkable(nav, door.hall, options.obstacles.get(door.hall.id) ?? [], position)) setHall(door.hall);
          break;
        }
      }
    } else if ((!hall.level || hall.level === 1) && portal) {
      const p = portalCoordinates(portal, position);
      if (p.along > 1 && Math.abs(p.across) < portal.width / 2) setHall();
    }
    position.y = visitorGroundHeight(nav, position, hall) + jumpOffset;
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
      return !doors.cutsPoint(h.point, h.object) && h.distance > .15;
    });
    if (hit) desired.copy(target).addScaledVector(direction, Math.max(.35, hit.distance - .3));
    if (immediate || options.reducedMotion()) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-10 * dt));
    camera.lookAt(target);
  }
  function start() {
    avatar.load();
    if (active) return;
    savedCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, near: camera.near };
    active = true; hall = undefined; portal = undefined; floorChange = undefined; autoRoute = []; actionHint = ''; resetJump();
    position.copy(nav.spawn); yaw = nav.heading; avatarYaw = yaw; fast = false; pitch = .17;
    camera.near = .08; camera.fov = 58; camera.updateProjectionMatrix();
    avatar.root.visible = true; avatar.root.position.copy(position); avatar.root.rotation.y = avatarYaw;
    doors.setEnabled(true); clearInput(); updateCamera(0, true);
    canvas.focus({ preventScroll: true }); publish(true); invalidate();
  }
  function stop() {
    if (!active) return;
    active = false; floorChange = undefined; autoRoute = []; resetJump(); setHall(); clearInput(); doors.setEnabled(false);
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
    if (key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (down && !e.repeat && !keys.has(' ')) { keys.add(' '); jump(); }
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
      e.preventDefault(); if (down) { if (key !== 'shift') cancelAutoWalk(); keys.add(key); } invalidate();
    }
  }
  window.addEventListener('keydown', e => keyboard(e, true), { signal });
  window.addEventListener('keyup', e => keyboard(e, false), { signal });
  window.addEventListener('blur', () => { clearInput(); cancelAutoWalk('Auto-walk paused. Select Go to hall to continue.'); }, { signal });
  canvas.addEventListener('blur', () => { keys.clear(); pointer = undefined; }, { signal });
  document.addEventListener('visibilitychange', () => { clearInput(); if (document.hidden) cancelAutoWalk('Auto-walk paused. Select Go to hall to continue.'); }, { signal });
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
  canvas.setAttribute('aria-label', '3D Bharat Mandapam. In visitor mode, W A S D to walk, arrow keys to turn, drag to look, Space to jump, Shift to walk faster, Escape to exit.');
  return {
    start, stop, goToDestination, enterNearby, jump, followRoute,
    stopAutoWalk() { cancelAutoWalk(); canvas.focus({ preventScroll: true }); },
    get active() { return active; },
    get position() { return position; },
    get heading() { return yaw; },
    input(input: VisitorInput, down: boolean) {
      if (!active) return;
      if (down) { cancelAutoWalk(); touches.add(input); } else touches.delete(input); invalidate();
    },
    step(input: VisitorInput) {
      if (!active || floorChange) return;
      cancelAutoWalk();
      if (input === 'left' || input === 'right') yaw += input === 'left' ? .25 : -.25;
      else { const d = input === 'forward' ? 1 : -1; slideVisitor(position, Math.sin(yaw) * d, Math.cos(yaw) * d, allowed); updateLocation(); }
      invalidate();
    },
    faster() { fast = !fast; publish(); canvas.focus({ preventScroll: true }); invalidate(); },
    destination(id: string) {
      if (!nav.portals.some(p => p.hall.id === id)) return;
      cancelAutoWalk(''); targetId = id; actionHint = ''; publish(); canvas.focus({ preventScroll: true }); invalidate();
    },
    restart() {
      if (!active) return;
      clearInput(); autoRoute = []; floorChange = undefined; resetJump(); setHall(); position.copy(nav.spawn); yaw = avatarYaw = nav.heading;
      actionHint = ''; updateCamera(0, true); publish(); canvas.focus({ preventScroll: true }); invalidate();
    },
    floor(level: number) {
      if (!active || !hall?.level || floorChange || jumping) return;
      const next = options.halls.find(h => h.level === level); if (!next || next === hall) return;
      const clear = (p: [number, number]) => visitorHallWalkable(nav, next, options.obstacles.get(next.id) ?? [], hallToWorld(next, p[0], 0, p[1]));
      let p = next.entrance;
      if (!clear(p)) p = next.route?.find(clear) ?? p;
      if (!clear(p)) return;
      cancelAutoWalk(''); clearInput(); floorChange = { start: performance.now(), hall: next, position: hallToWorld(next, p[0], next.elevation?.(...p) ?? 0, p[1]) };
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
      const wasAutoWalking = autoRoute.length > 0, previousX = position.x, previousZ = position.z;
      const travelled = floorChange ? 0 : wasAutoWalking ? advanceAutoWalk(dt) : slideVisitor(position, dx, dz, allowed);
      if (travelled > .0001) {
        const aim = wasAutoWalking ? Math.atan2(position.x - previousX, position.z - previousZ) : Math.atan2(dx, dz);
        avatarYaw += Math.atan2(Math.sin(aim - avatarYaw), Math.cos(aim - avatarYaw)) * Math.min(1, dt * 12);
        if (wasAutoWalking && !pointer) yaw += Math.atan2(Math.sin(aim - yaw), Math.cos(aim - yaw)) * (1 - Math.exp(-8 * dt));
      }
      updateLocation();
      updateJump(dt);
      avatar.root.position.copy(position); avatar.root.rotation.y = avatarYaw;
      avatar.update(dt, dt ? Math.min(5.5, travelled / dt) : 0, options.reducedMotion(), jumpOffset);
      doors.update(position, dt, dt ? travelled / dt : 0, options.reducedMotion()); updateCamera(dt);
      if (now - lastState > 180) { publish(); lastState = now; }
      // Follow-camera and sliding-door settling are bounded to active visitor mode.
      return true;
    },
    dispose() { stop(); avatar.dispose(); doors.dispose(); },
  };
}
