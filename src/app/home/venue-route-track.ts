import * as T from 'three';
import { buildRouteGeometry, Point, positionAtDistance, RouteGeometry, roundCorners } from './venue-route-geometry';
import { createVisitorAvatar } from './visitor-avatar';

/**
 * The walking route in the explorer, re-created from the ITPO app's RouteTrack: a white casing under a blue
 * track with marching dots, green start and red end dots, a leading puck, and a visitor walking the route.
 * The ribbon is built once per route; its width is a uniform scaled with the camera so it keeps the same
 * screen width at every zoom. It draws over roofs (no depth test), since it is read from above.
 */
const TRACK = new T.Color('#0A81FF'), CASING = new T.Color('#ffffff'), START = new T.Color('#10B981'), END = new T.Color('#DC344B');
const TRACK_PX = 6, CASING_PX = 10, DOT_GAP_PX = 22, END_PX = 9, PUCK_PX = 8;
/** The app caps its redraw rate; dots read as smooth well below 60 fps. */
export const ROUTE_FRAME_MS = 1000 / 40;
const LIFT = .6;

function ribbon(points: Point[]) {
  // Centre line plus a mitred side vector per vertex; the shader scales the side by the width uniform.
  const positions: number[] = [], sides: number[] = [], along: number[] = [], across: number[] = [], index: number[] = [];
  let distance = 0;
  points.forEach((p, i) => {
    if (i) distance += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const before = new T.Vector2(p.x - a.x, p.z - a.z), after = new T.Vector2(b.x - p.x, b.z - p.z);
    if (!before.lengthSq()) before.copy(after); if (!after.lengthSq()) after.copy(before);
    before.normalize(); after.normalize();
    const tangent = before.clone().add(after).normalize(), normal = new T.Vector2(-tangent.y, tangent.x);
    const mitre = 1 / Math.max(.6, normal.dot(new T.Vector2(-after.y, after.x)));
    for (const s of [-1, 1]) { positions.push(p.x, LIFT, p.z); sides.push(normal.x * mitre * s, normal.y * mitre * s); along.push(distance); across.push(s); }
    if (i) index.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
  });
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('side', new T.Float32BufferAttribute(sides, 2));
  geometry.setAttribute('along', new T.Float32BufferAttribute(along, 1));
  geometry.setAttribute('across', new T.Float32BufferAttribute(across, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

function trackMaterial(color: T.Color, pixels: number, dots: boolean, uniforms: { metresPerPixel: { value: number }; dotOffset: { value: number } }) {
  return new T.ShaderMaterial({
    // Double-sided: the ribbon's winding depends on the route's direction, and it is only ever seen from above.
    depthTest: false, depthWrite: false, transparent: true, toneMapped: false, side: T.DoubleSide,
    uniforms: { color: { value: color }, pixels: { value: pixels }, gap: { value: DOT_GAP_PX }, ...uniforms },
    vertexShader: `attribute vec2 side; attribute float along; attribute float across; uniform float metresPerPixel; uniform float pixels; varying float vAlong; varying float vAcross;
      void main() { vAlong = along; vAcross = across;
        vec3 p = position + vec3(side.x, 0.0, side.y) * pixels * 0.5 * metresPerPixel;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform vec3 color; uniform float metresPerPixel; uniform float gap; uniform float dotOffset; uniform float pixels; varying float vAlong; varying float vAcross;
      void main() {
        ${dots ? `float period = gap * metresPerPixel; float d = mod(vAlong - dotOffset, period) / metresPerPixel;
        float across = abs(vAcross) * pixels * 0.5; float r = length(vec2(min(d, gap - d), across));
        if (r > 1.8) discard;` : ''}
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function disc(color: T.Color, order: number, inner = 0) {
  const mesh = new T.Mesh((inner ? new T.RingGeometry(inner, .5, 32) : new T.CircleGeometry(.5, 24)).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
  mesh.renderOrder = order; mesh.frustumCulled = false; return mesh;
}

export function createVenueRouteTrack(scene: T.Scene, invalidate: () => void) {
  const group = new T.Group(); group.name = 'Venue walking route'; group.visible = false; scene.add(group);
  const uniforms = { metresPerPixel: { value: .5 }, dotOffset: { value: 0 } };
  const casingMaterial = trackMaterial(CASING, CASING_PX, false, uniforms), trackMaterial_ = trackMaterial(TRACK, TRACK_PX, false, uniforms);
  const dotMaterial = trackMaterial(CASING, TRACK_PX, true, uniforms);
  let geometry = new T.BufferGeometry();
  const casing = new T.Mesh(geometry, casingMaterial), track = new T.Mesh(geometry, trackMaterial_), dots = new T.Mesh(geometry, dotMaterial);
  [casing, track, dots].forEach((mesh, i) => { mesh.renderOrder = 20 + i; mesh.frustumCulled = false; group.add(mesh); });
  const startCasing = disc(CASING, 23), start = disc(START, 24), endCasing = disc(CASING, 23), end = disc(END, 24);
  // The leading puck is an open ring, so the walking visitor inside it stays visible from above.
  const puckHalo = disc(TRACK, 25), puckCasing = disc(CASING, 26, .3), puck = disc(TRACK, 27, .36);
  (puckHalo.material as T.MeshBasicMaterial).opacity = .18;
  group.add(startCasing, start, endCasing, end, puckHalo, puckCasing, puck);
  const walker = createVisitorAvatar({ invalidate }); walker.root.visible = false; scene.add(walker.root);
  let route: RouteGeometry | undefined, progress = 0, last = 0, speed = 10, active = false;
  const head = { x: 0, z: 0, yaw: 0 };
  const place = (mesh: T.Object3D, p: Point, px: number, mpp: number) => { mesh.position.set(p.x, LIFT + .02, p.z); mesh.scale.setScalar(px * mpp); };
  return {
    group,
    get active() { return active; },
    /** Show a route (world x/z polyline, start first); the walk starts again from the beginning. */
    show(points: Point[]) {
      route = buildRouteGeometry(roundCorners(points, 6));
      if (route.segments.length === 0) { this.clear(); return; }
      const next = ribbon(route.points);
      [casing, track, dots].forEach(mesh => mesh.geometry = next); geometry.dispose(); geometry = next;
      // A long route is walked in ~25 s, a short one at no less than a brisk 6 m/s, so the visit reads at a glance.
      speed = T.MathUtils.clamp(route.totalLength / 25, 6, 45);
      progress = 0; last = 0; active = true; group.visible = true; walker.root.visible = true; walker.load(); invalidate();
    },
    clear() { active = false; route = undefined; group.visible = false; walker.root.visible = false; invalidate(); },
    /** Advance the walk and keep sizes constant on screen. True while the route needs more frames. */
    update(now: number, camera: T.PerspectiveCamera, viewportHeight: number, reducedMotion: boolean) {
      if (!active || !route) return false;
      const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
      if (!reducedMotion) progress = (progress + dt * speed) % route.totalLength;
      // Metres per screen pixel at the ground under the view.
      const mpp = 2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, camera.position.y - LIFT) / viewportHeight;
      uniforms.metresPerPixel.value = mpp;
      uniforms.dotOffset.value = reducedMotion ? 0 : (now / 1000 * DOT_GAP_PX * 1.6 * mpp) % (DOT_GAP_PX * mpp);
      const first = route.points[0], lastPoint = route.points[route.points.length - 1];
      place(startCasing, first, END_PX + 4, mpp); place(start, first, END_PX, mpp);
      place(endCasing, lastPoint, END_PX + 4, mpp); place(end, lastPoint, END_PX, mpp);
      positionAtDistance(route, progress, head);
      place(puckHalo, head, PUCK_PX * 4.4, mpp); place(puckCasing, head, PUCK_PX * 3.4, mpp); place(puck, head, PUCK_PX * 3, mpp);
      // Seen from straight above a person is their shoulders (~0.55 m); keep those ~14 px across inside the ring.
      walker.root.position.set(head.x, 0, head.z); walker.root.rotation.y = head.yaw;
      // Draw the visitor after the depth-less track so it stands on top of it; meshes arrive when the model loads.
      walker.root.traverse(o => {
        if (!(o instanceof T.Mesh) || o.userData['routeWalker']) return;
        o.userData['routeWalker'] = true; o.renderOrder = 40;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.transparent = true;
      });
      walker.root.scale.setScalar(Math.max(1, 14 * mpp / .55));
      walker.update(dt, reducedMotion ? 0 : 1.6, reducedMotion);
      return !reducedMotion;
    },
    dispose() {
      walker.dispose(); walker.root.removeFromParent(); group.removeFromParent(); geometry.dispose();
      [casingMaterial, trackMaterial_, dotMaterial].forEach(m => m.dispose());
      for (const mesh of [startCasing, start, endCasing, end, puckHalo, puckCasing, puck]) { mesh.geometry.dispose(); (mesh.material as T.Material).dispose(); }
    },
  };
}
