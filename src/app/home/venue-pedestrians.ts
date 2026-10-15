import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createCrowdBatch } from './venue-crowd-batch';
import { disposeVisitorModel } from './visitor-avatar-rig';
import { campusWalkable, VisitorNavigation } from './visitor-navigation';

const S = new T.Vector3(.5, 0, -Math.sqrt(3) / 2);
const U = new T.Vector3(Math.sqrt(3) / 2, 0, .5);
export interface PedestrianRoute { origin: T.Vector3; along: T.Vector3; length: number; radius: number; zone?: string; }
type PathCandidate = [T.Vector3, T.Vector3, number, number, string?];
type PathTest = ((p: T.Vector3) => boolean) & { candidates?: PathCandidate[] };

/** Capture authored pedestrian surfaces before render batching removes names. */
export function capturePedestrianPaths(root: T.Object3D) {
  const cells = new Map<string, T.Triangle[]>(), point = new T.Vector3();
  const candidates: PathCandidate[] = [];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    const name = `${o.name} ${o.parent?.name}`;
    if (!(o.userData['continuousCoveredFloor'] || /PHOTO_PATH/.test(name)) || /drive|service|edge_inlay/i.test(name)) return;
    const positions = o.geometry.getAttribute('position'), index = o.geometry.index;
    // Authored paths consist of short paving strips. Their wide edges give
    // the real centerline direction, including diagonal gate approaches.
    if (!o.userData['continuousCoveredFloor'] && index) {
      const runs = new Map<string, PathCandidate>();
      for (let i = 0; i + 5 < index.count; i += 6) {
        const ids = [...new Set(Array.from({length:6}, (_,k) => index.getX(i+k)))];
        if (ids.length !== 4) continue;
        const p = ids.map(id => new T.Vector3().fromBufferAttribute(positions, id).applyMatrix4(o.matrixWorld));
        const center = p.reduce((sum,v) => sum.add(v), new T.Vector3()).multiplyScalar(.25);
        p.sort((a,b) => Math.atan2(a.z-center.z,a.x-center.x)-Math.atan2(b.z-center.z,b.x-center.x));
        let edge = 0;
        for (let k=1;k<4;k++) if (p[k].distanceToSquared(p[(k+1)%4]) > p[edge].distanceToSquared(p[(edge+1)%4])) edge=k;
        const a=p[edge].clone().add(p[(edge+1)%4]).multiplyScalar(.5);
        const b=p[(edge+2)%4].clone().add(p[(edge+3)%4]).multiplyScalar(.5);
        const axis=b.clone().sub(a).setY(0).normalize();
        if (axis.x < -.001 || (Math.abs(axis.x)<.001 && axis.z<0)) axis.negate();
        const key=`${Math.round(Math.atan2(axis.x,axis.z)*100)},${Math.round((a.x*axis.z-a.z*axis.x)*2)}`;
        const run=runs.get(key);
        if (run) {
          for (const v of [a,b]) {const d=v.sub(run[1]).dot(run[0]);run[2]=Math.min(run[2],d);run[3]=Math.max(run[3],d);}
        } else runs.set(key,[axis,a.clone().setY(a.y+.01),Math.min(0,b.clone().sub(a).dot(axis)),Math.max(0,b.sub(a).dot(axis)),/PHOTO_PATH/.test(o.name) ? o.name : o.parent?.name || o.name]);
      }
      candidates.push(...runs.values());
    }
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const p = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(o.matrixWorld).setY(0));
      const triangle = new T.Triangle(p[0], p[1], p[2]), box = new T.Box3().setFromPoints(p);
      if (triangle.getArea() < .001) continue;
      for (let x = Math.floor(box.min.x / 16); x <= Math.floor(box.max.x / 16); x++)
        for (let z = Math.floor(box.min.z / 16); z <= Math.floor(box.max.z / 16); z++) {
          const key = `${x},${z}`, bucket = cells.get(key);
          if (bucket) bucket.push(triangle); else cells.set(key, [triangle]);
        }
    }
  });
  return Object.assign((p: T.Vector3) => {
    point.copy(p).setY(0);
    return cells.get(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`)?.some(t => t.containsPoint(point)) ?? false;
  }, { candidates });
}

/** Constant-speed capsule loop: continuous tangent at both turns, no endpoint teleport. */
export function samplePedestrianRoute(route: PedestrianRoute, distance: number, point: T.Vector3, tangent: T.Vector3) {
  const { length, radius, along, origin } = route;
  const perimeter = 2 * length + 2 * Math.PI * radius;
  let d = ((distance % perimeter) + perimeter) % perimeter, a = 0, b = 0, da = 0, db = 0;
  if (d < length) { a = d; b = -radius; da = 1; }
  else if ((d -= length) < Math.PI * radius) {
    const theta = d / radius; a = length + radius * Math.sin(theta); b = -radius * Math.cos(theta);
    da = Math.cos(theta); db = Math.sin(theta);
  } else if ((d -= Math.PI * radius) < length) { a = length - d; b = radius; da = -1; }
  else { d -= length; const theta = d / radius; a = -radius * Math.sin(theta); b = radius * Math.cos(theta); da = -Math.cos(theta); db = -Math.sin(theta); }
  point.copy(origin).addScaledVector(along, a);
  point.x += along.z * b; point.z -= along.x * b;
  tangent.set(along.x * da + along.z * db, 0, along.z * da - along.x * db);
}

/** Fit only to existing concourses, checking the whole body against real walls,
 * column plinths, water and guards once, rather than raycasting every frame. */
export function planPedestrianRoutes(nav: VisitorNavigation, onPath: PathTest = () => true): PedestrianRoute[] {
  const routes: PedestrianRoute[] = [], point = new T.Vector3(), tangent = new T.Vector3();
  const candidates: PathCandidate[] = [
    [U, S.clone().multiplyScalar(-103).setY(.19), -110, 165],
    [S, U.clone().multiplyScalar(177).setY(.19), -80, 280],
    [S, U.clone().multiplyScalar(102).setY(.19), -265, -110],
    [U, S.clone().multiplyScalar(295).setY(.19), 90, 170],
    [S, U.clone().multiplyScalar(-111).setY(.19), -80, 75],
    [U, S.clone().multiplyScalar(-109).setY(.19), -110, 165],
    ...(onPath.candidates ?? []),
  ];
  for (const [axis, origin, from, to, zone] of candidates) {
    let start: number | undefined;
    const clear = (distance: number) => [-1.1, 0, 1.1].every(offset => {
      point.copy(origin).addScaledVector(axis, distance);
      point.x += axis.z * offset; point.z -= axis.x * offset;
      return onPath(point) && campusWalkable(nav, point);
    });
    const add = (end: number) => {
      if (start === undefined || end - start < 24) return;
      const route = { origin: origin.clone().addScaledVector(axis, start + 2), along: axis.clone(), length: end - start - 4, radius: 1.1, zone: zone ?? 'Covered concourse' };
      const perimeter = 2 * route.length + 2 * Math.PI * route.radius;
      for (let d = 0; d < perimeter; d += .5) {
        samplePedestrianRoute(route, d, point, tangent);
        if (!onPath(point) || !campusWalkable(nav, point)) return;
      }
      routes.push(route);
    };
    for (let d = from; d <= to; d += 2) {
      if (clear(d)) start ??= d;
      else { add(d - 2); start = undefined; }
    }
    add(to);
  }
  const distinct: PedestrianRoute[] = [];
  for (const route of routes.sort((a,b)=>b.length-a.length)) {
    if (distinct.some(other => {
      if (Math.abs(route.along.dot(other.along)) < .995) return false;
      const delta=route.origin.clone().sub(other.origin);
      if (Math.abs(delta.x*other.along.z-delta.z*other.along.x)>3) return false;
      const a=delta.dot(other.along), b=a+route.length*route.along.dot(other.along);
      return Math.min(other.length,Math.max(a,b))-Math.max(0,Math.min(a,b)) > route.length*.5;
    })) continue;
    distinct.push(route);
  }
  return distinct.slice(0, 32);
}

const CROWD_COUNT = 360;

export async function createVenuePedestrians(options: { navigation: VisitorNavigation; onPath: (p: T.Vector3) => boolean; asset: (name: string) => string; signal: AbortSignal }) {
  const routes = planPedestrianRoutes(options.navigation, options.onPath);
  const group = new T.Group(); group.name = 'Slow concourse pedestrians';
  if (!routes.length) return { group, update: () => false, dispose: () => group.removeFromParent() };
  const load = async (name: string) => {
    const response = await fetch(options.asset('characters/' + name), { signal: options.signal });
    if (!response.ok) throw new Error(`Crowd asset unavailable (${response.status})`);
    const bytes = await response.arrayBuffer(); options.signal.throwIfAborted();
    return new GLTFLoader().parseAsync(bytes, '');
  };
  const loaded = await Promise.allSettled([load('visitor-nathan.glb'), load('crowd-nathan-near.glb'), load('crowd-nathan-lod.glb')]);
  if (loaded.some(result => result.status === 'rejected')) {
    loaded.forEach(result => { if (result.status === 'fulfilled') disposeVisitorModel(result.value.scene); });
    throw (loaded.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
  }
  const [high, near, low] = loaded.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof load>>>).value);
  let material: T.MeshStandardMaterial | undefined;
  high.scene.traverse(o => { if (o instanceof T.SkinnedMesh) material ??= o.material as T.MeshStandardMaterial; });
  const batches: Awaited<ReturnType<typeof createCrowdBatch>>[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    batches.forEach(batch => batch.dispose());
    disposeVisitorModel(high.scene); disposeVisitorModel(near.scene); disposeVisitorModel(low.scene);
    group.removeFromParent(); group.clear();
  };
  try {
    if (!material) throw new Error('Crowd material missing');
    options.signal.throwIfAborted();
    for (const source of [low, near]) {
      const batch = await createCrowdBatch(clone(source.scene) as T.Group, source.animations, material, CROWD_COUNT, options.signal);
      batch.mesh.name = source === low ? 'Pedestrians distance batch' : 'Pedestrians near batch';
      batches.push(batch); group.add(batch.mesh);
    }
  } catch (error) { dispose(); throw error; }
  const totalLength = routes.reduce((sum, r) => sum + r.length, 0);
  const counts = routes.map(r => 8 + Math.floor((CROWD_COUNT - routes.length * 8) * r.length / totalLength));
  const remainder = CROWD_COUNT - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) counts[i % routes.length]++;
  let personIndex = 0;
  const people = routes.flatMap((route, routeIndex) => Array.from({ length: counts[routeIndex] }, (_, member) => {
    const i = personIndex++, phase = (member + .35) / counts[routeIndex];
    return { route, distance: phase * (2 * route.length + 2 * Math.PI * route.radius),
      phase: (i * .381966) % 1, speed: .55 + (i % 5) * .08, weight: 1,
      point: new T.Vector3(), tangent: new T.Vector3(), blocked: false, distanceToCamera: 0, detail: 0, cellX: 0, cellZ: 0 };
  }));
  const matrix = new T.Matrix4(), frustum = new T.Frustum(), sphere = new T.Sphere(new T.Vector3(), 1.5);
  const visible: typeof people = [], transform = new T.Matrix4(), rotation = new T.Quaternion(), scale = new T.Vector3(1, 1, 1);
  const neighbors = new Map<string, typeof people>();
  let last = 0, slowFrames = 0, pressure = false, wasMobile: boolean | undefined;
  group.userData = { pedestrianCount: people.length, routeCount: routes.length, maxVisible: 160,
    routeZones: [...new Set(routes.map(route => route.zone))],
    speedMetersPerSecond: [.55, .87], sharedGeometry: true, sharedTextures: true,
    gpuAnimation: true, maxDrawCalls: 2, animatedShadows: false };
  return { group, dispose,
    update(now: number, camera: T.PerspectiveCamera, viewportHeight: number, enabled = true, reducedMotion = false, player?: T.Vector3) {
      if (disposed) return false;
      const rawDt = last ? (now - last) / 1000 : 0; last = now;
      const dt = T.MathUtils.clamp(rawDt, 0, .05);
      group.visible = enabled;
      if (!enabled) { group.userData['visibleCount'] = 0; return false; }
      const mobile = camera.aspect < .85 || viewportHeight < 500;
      if (wasMobile !== mobile) { pressure = false; slowFrames = 0; wasMobile = mobile; }
      slowFrames = rawDt > .024 && rawDt < .25 ? Math.min(120, slowFrames + 2) : Math.max(0, slowFrames - 1);
      if (slowFrames > 60) pressure = true;
      const limit = pressure ? (mobile ? 56 : 96) : (mobile ? 96 : 160);
      const highLimit = pressure ? 2 : mobile ? 3 : 8;
      camera.updateMatrixWorld(); matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(matrix);
      visible.length = 0;
      neighbors.clear();
      for (const person of people) {
        samplePedestrianRoute(person.route, person.distance, person.point, person.tangent);
        person.cellX = Math.floor(person.point.x / 1.5); person.cellZ = Math.floor(person.point.z / 1.5);
        const key = `${person.cellX},${person.cellZ}`, bucket = neighbors.get(key);
        if (bucket) bucket.push(person); else neighbors.set(key, [person]);
      }
      for (const person of people) {
        person.blocked = !!player && person.point.distanceToSquared(player) < 2.25;
        // Yield to the person immediately ahead instead of walking through them.
        for (let dx = -1; dx <= 1 && !person.blocked; dx++) for (let dz = -1; dz <= 1 && !person.blocked; dz++)
          person.blocked = neighbors.get(`${person.cellX + dx},${person.cellZ + dz}`)?.some(other => other !== person &&
            person.point.distanceToSquared(other.point) < 1.4 && person.tangent.dot(other.tangent) > .5 &&
            (other.point.x - person.point.x) * person.tangent.x + (other.point.z - person.point.z) * person.tangent.z > .05) ?? false;
        if (!reducedMotion && !person.blocked) {
          person.distance += dt * person.speed;
          person.phase = (person.phase + dt * person.speed / (batches[1].capturedSpeed * batches[1].strideDuration)) % 1;
        }
        person.weight = reducedMotion ? 0 : T.MathUtils.damp(person.weight, person.blocked ? 0 : 1, 12, dt);
        sphere.center.copy(person.point); sphere.center.y += .9;
        person.distanceToCamera = camera.position.distanceToSquared(sphere.center);
        if (person.distanceToCamera < 900 ** 2 && frustum.intersectsSphere(sphere)) visible.push(person);
      }
      visible.sort((a, b) => a.distanceToCamera - b.distanceToCamera);
      visible.length = Math.min(visible.length, limit);
      batches.forEach(batch => batch.mesh.count = 0);
      let highCount = 0;
      const pixelScale = viewportHeight / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
      for (const person of visible) {
        const pixels = 1.8 * pixelScale / Math.sqrt(person.distanceToCamera);
        // Hysteresis avoids switching repeatedly at a single distance threshold.
        person.detail = highCount < highLimit && pixels > (person.detail ? 70 : 95) ? 1 : 0;
        if (person.detail) highCount++;
        const batch = batches[person.detail], slot = batch.mesh.count++;
        rotation.setFromAxisAngle(T.Object3D.DEFAULT_UP, Math.atan2(person.tangent.x, person.tangent.z));
        transform.compose(person.point, rotation, scale); batch.mesh.setMatrixAt(slot, transform);
        batch.phases.setXY(slot, person.phase, person.weight);
      }
      batches.forEach(batch => batch.commit());
      Object.assign(group.userData, { visibleCount: visible.length, nearCount: highCount, maxVisible: limit, renderScale: pressure ? .8 : 1,
        lowTriangles: batches[0].mesh.geometry.index!.count / 3, highTriangles: batches[1].mesh.geometry.index!.count / 3 });
      return visible.length > 0 && !reducedMotion;
    }
  };
}
