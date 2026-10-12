import * as T from 'three';

/** The supplied crossed-leg scan has weights leaking onto the opposite thigh.
 * Resolve limb ownership in its original bind pose, before straightening the rig. */
export function repairVisitorLegWeights(model: T.Group, bones: Map<string, T.Bone>) {
  const sides = ['L', 'R'] as const;
  const chains = sides.map(side => ['Thigh', 'Calf', 'Foot'].map(part =>
    bones.get(`${side}_${part}`)!.getWorldPosition(new T.Vector3())));
  const segments = chains.map(chain => [new T.Line3(chain[0], chain[1]), new T.Line3(chain[1], chain[2])]);
  const hipHeight = Math.min(chains[0][0].y, chains[1][0].y);
  const position = new T.Vector3(), closest = new T.Vector3();
  model.traverse(object => {
    if (!(object instanceof T.SkinnedMesh)) return;
    const geometry = object.geometry, sourceIndices = geometry.getAttribute('skinIndex');
    const sourceWeights = geometry.getAttribute('skinWeight'), positions = geometry.getAttribute('position');
    const indices = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4);
    const names = object.skeleton.bones.map(bone => bone.name);
    const hip = names.indexOf('Hip');
    const leg = names.map(name => /^[LR]_(Thigh|Calf|Foot)/.test(name));
    const counterparts = names.map(name => sides.map(side => names.indexOf(name.replace(/^[LR]_/, `${side}_`))));
    // At the crossed thighs, Euclidean proximity picks the other leg. Follow
    // the trouser surface upward from the unambiguous, separated lower legs.
    const owners = new Int8Array(positions.count).fill(-1), distances = new Float64Array(positions.count).fill(Infinity);
    const canonical = new Uint32Array(positions.count), welded = new Map<string, number>();
    const points: T.Vector3[] = [], adjacency: number[][] = Array.from({ length: positions.count }, () => []);
    const heap: { vertex: number; distance: number }[] = [];
    function push(vertex: number, distance: number) {
      let at = heap.length; heap.push({ vertex, distance });
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (heap[parent].distance <= distance) break;
        heap[at] = heap[parent]; at = parent;
      }
      heap[at] = { vertex, distance };
    }
    function pop() {
      const first = heap[0], last = heap.pop()!;
      if (heap.length) {
        let at = 0;
        while (at * 2 + 1 < heap.length) {
          let child = at * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child++;
          if (heap[child].distance >= last.distance) break;
          heap[at] = heap[child]; at = child;
        }
        heap[at] = last;
      }
      return first;
    }
    for (let i = 0; i < positions.count; i++) {
      const p = new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld); points.push(p);
      const key = `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
      const alias = welded.get(key); canonical[i] = alias ?? i;
      if (alias === undefined) welded.set(key, i);
    }
    const index = geometry.index;
    if (!index) throw new Error('Visitor skin repair requires the indexed supplied mesh.');
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [canonical[index.getX(i)], canonical[index.getX(i + 1)], canonical[index.getX(i + 2)]];
      for (let k = 0; k < 3; k++) {
        const a = triangle[k], b = triangle[(k + 1) % 3];
        if (a !== b && points[a].y < hipHeight + .06 && points[b].y < hipHeight + .06) {
          adjacency[a].push(b); adjacency[b].push(a);
        }
      }
    }
    for (let i = 0; i < positions.count; i++) {
      if (canonical[i] !== i || points[i].y > Math.min(chains[0][1].y, chains[1][1].y)) continue;
      let legWeight = 0;
      for (let k = 0; k < 4; k++) if (leg[sourceIndices.getComponent(i, k)]) legWeight += sourceWeights.getComponent(i, k);
      if (legWeight < .5) continue;
      const d = segments.map(chain => Math.min(...chain.map(segment => segment.closestPointToPoint(points[i], true, closest).distanceToSquared(points[i]))));
      owners[i] = d[0] <= d[1] ? 0 : 1; distances[i] = 0; push(i, 0);
    }
    while (heap.length) {
      const current = pop();
      if (current.distance !== distances[current.vertex]) continue;
      for (const neighbor of adjacency[current.vertex]) {
        const distance = current.distance + points[current.vertex].distanceTo(points[neighbor]);
        if (distance >= distances[neighbor]) continue;
        distances[neighbor] = distance; owners[neighbor] = owners[current.vertex]; push(neighbor, distance);
      }
    }
    for (let i = 0; i < positions.count; i++) {
      position.copy(points[i]);
      const strength = 1 - T.MathUtils.smoothstep(position.y, hipHeight - .01, hipHeight + .06);
      const distance = segments.map(chain => Math.min(...chain.map(segment =>
        segment.closestPointToPoint(position, true, closest).distanceToSquared(position))));
      const owner = owners[canonical[i]] >= 0 ? owners[canonical[i]] : distance[0] <= distance[1] ? 0 : 1;
      const merged = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const joint = sourceIndices.getComponent(i, k);
        let weight = sourceWeights.getComponent(i, k);
        if (!weight) continue;
        // Hold the trouser waistband and shirt hem on the pelvis while the
        // thighs separate; otherwise the original thigh weights tear the waist.
        const waist = leg[joint] && hip >= 0 ? T.MathUtils.smoothstep(position.y, hipHeight - .105, hipHeight - .025) : 0;
        if (waist) { merged.set(hip, (merged.get(hip) ?? 0) + weight * waist); weight *= 1 - waist; }
        const other = leg[joint] && names[joint][0] !== sides[owner] ? counterparts[joint][owner] : joint;
        const transfer = other >= 0 && other !== joint ? strength : 0;
        merged.set(joint, (merged.get(joint) ?? 0) + weight * (1 - transfer));
        if (transfer) merged.set(other, (merged.get(other) ?? 0) + weight * transfer);
      }
      const influences = [...merged].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = influences.reduce((sum, [, weight]) => sum + weight, 0);
      influences.forEach(([joint, weight], k) => {
        indices[i * 4 + k] = joint; weights[i * 4 + k] = weight / total;
      });
    }
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
  });
}
