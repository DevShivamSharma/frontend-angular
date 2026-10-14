import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as T from 'three';
import { batchVenue } from '../src/app/home/venue-batching';
import { PLAZA_PLANTERS, prepareVenueSurfaceDetail } from '../src/app/home/venue-surface-detail';
import { ITPO_WALKWAY_BINS, ITPO_WALKWAY_PLANTER_T, ITPO_WALKWAY_RUNS } from '../src/app/home/venue-edge-detail';
import { addItpoExterior, GATE9_CHECK_ROOM } from '../src/app/home/venue-itpo-exterior';
import { ITPO_PORCH, prepareItpoArrival } from '../src/app/home/venue-itpo-arrival';

// Decode the supplied geometry without a browser or texture/network mocks.
// This verifies placement against every actual visible obstacle, not a copied
// rectangle or a list of assumed building names.
function suppliedGeometry() {
    const bytes = readFileSync('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
    const length = bytes.readUInt32LE(12), data = JSON.parse(bytes.subarray(20, 20 + length).toString());
    const binary = 28 + length, root = new T.Group();
    function values(index: number): number[] {
        const a = data.accessors[index], view = data.bufferViews[a.bufferView];
        const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[a.type];
        const component = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType];
        const out: number[] = [];
        for (let i = 0; i < a.count; i++) for (let j = 0; j < size; j++) {
            const offset = binary + (view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || size * component) + j * component;
            out.push(a.componentType === 5126 ? bytes.readFloatLE(offset) : bytes.readUIntLE(offset, component));
        }
        return out;
    }
    const materials = data.materials.map((definition: any) => {
        const material = new T.MeshStandardMaterial({ side: T.DoubleSide });
        material.name = definition.name; material.userData = definition.extras ?? {};
        return material;
    });
    function visit(index: number, parent: T.Matrix4, hidden = false) {
        const node = data.nodes[index];
        const local = node.matrix ? new T.Matrix4().fromArray(node.matrix) : new T.Matrix4().compose(
            new T.Vector3(...(node.translation ?? [0, 0, 0])),
            new T.Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new T.Vector3(...(node.scale ?? [1, 1, 1])));
        const world = parent.clone().multiply(local);
        hidden ||= Boolean(node.extras?.cc_level) || /^(OUTER_GROUND|CONTEXT_GROUND)$/.test(node.name);
        if (!hidden && node.mesh !== undefined) for (const primitive of data.meshes[node.mesh].primitives) {
            const geometry = new T.BufferGeometry();
            geometry.setAttribute('position', new T.Float32BufferAttribute(values(primitive.attributes.POSITION), 3));
            if (primitive.attributes.TEXCOORD_0 !== undefined)
                geometry.setAttribute('uv', new T.Float32BufferAttribute(values(primitive.attributes.TEXCOORD_0), 2));
            if (primitive.indices !== undefined) geometry.setIndex(values(primitive.indices));
            geometry.applyMatrix4(world); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
            const mesh = new T.Mesh(geometry, materials[primitive.material]); mesh.name = node.name; root.add(mesh);
        }
        for (const child of node.children ?? []) visit(child, world, hidden);
    }
    for (const node of data.scenes[data.scene ?? 0].nodes) visit(node, new T.Matrix4());
    return root;
}

test('ITPO arrival moves only the porch to the left wall, preserves buildings and clears the approach', () => {
    const root = suppliedGeometry(), authored = [...root.children] as T.Mesh[];
    for (const object of authored) if (object.name.startsWith('PHOTO_ADMIN')) {
        object.visible = false; object.userData['supersededBySiteReference'] = true;
    }
    const geometry = authored.map(object => object.geometry);
    for (const object of authored) if (/ITPO side (curved stone drum|ribbon windows)/.test(object.name))
        (object.material as T.MeshStandardMaterial).side = T.FrontSide;
    // Exercise the actual walkway together with the relocated porch.
    prepareVenueSurfaceDetail(root);
    prepareItpoArrival(root); prepareItpoArrival(root); root.updateMatrixWorld(true);
    const additions = root.getObjectByName('SITE_DETAIL_itpo_arrival') as T.Group;
    expect(root.children.filter(o => o.name === additions.name)).toHaveLength(1);
    expect(root.getObjectByName('PHOTO_ADMIN office ground court')!.visible).toBe(true);
    expect(root.getObjectByName('PHOTO_ADMIN Office to CC separating drive')!.visible).toBe(true);
    expect(root.getObjectByName('PHOTO_ADMIN Office rear loop')!.visible).toBe(false);
    let changedVertices = 0;
    authored.forEach((object, i) => {
        const before = geometry[i].getAttribute('position'), after = object.geometry.getAttribute('position');
        expect(after.count).toBe(before.count);
        for (let v = 0; v < before.count; v++) {
            const p = new T.Vector3().fromBufferAttribute(before, v), q = new T.Vector3().fromBufferAttribute(after, v);
            if (p.distanceTo(q) < .0001) continue;
            changedVertices++;
            const source = p.clone().applyAxisAngle(new T.Vector3(0, 1, 0), -Math.PI / 3);
            expect(object.name).toMatch(/^PHOTO_ITPO office (sandstone structure|entrance planting)$/);
            expect(source.x).toBeGreaterThan(-405.1);
            expect(source.y).toBeLessThan(6.1);
        }
        expect(object.position.length(), object.name).toBe(0);
    });
    // Six porch solids (roof, two columns, three steps) and four planter solids.
    expect(changedVertices).toBe(240);
    const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
    const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + .8660254038 * t, y, -.8660254038 * s + .5 * t);
    const office = authored.filter(o => /^PHOTO_ITPO office /.test(o.name));
    ray.set(W(-395, -365.45, 12), down);
    expect(ray.intersectObjects(office, false), 'old front porch is completely removed').toHaveLength(0);
    ray.set(W(ITPO_PORCH.s, -344, 12), down);
    const roof = ray.intersectObjects(office, false)[0];
    expect(roof?.point.y, 'roof is now attached to the left wall').toBeCloseTo(6.18, 1);
    const walkway = root.getObjectByName('SITE_EDGE_itpo_walkway')!;
    for (let s = -444; s <= -432; s += 2) {
        ray.set(W(s, -344, 2), down);
        expect(ray.intersectObjects([walkway], true), 'no planter across entrance').toHaveLength(0);
    }
    const drive = authored.filter(o => /Office to CC separating drive$/.test(o.name));
    for (let s = -449; s <= -427; s += 2) for (let t = -353; t <= -336; t += 2) {
        ray.set(W(s, t, 2), down);
        expect(ray.intersectObjects(drive, false), 'side landing clear of road').toHaveLength(0);
    }
    // Source triangles have mixed winding: no alternating holes may expose the
    // unrelated shell or interior behind the photo-facing stone/window bands.
    for (let t = -315; t <= -249; t += 2) {
        ray.set(W(-410, t, 10), W(1, 0, 0).normalize());
        const first = ray.intersectObjects(authored, false)[0];
        expect(first?.object.name, `continuous facade at ${t}`).toMatch(/ITPO side (curved stone drum|ribbon windows)/);
    }
    for (const y of [13.3, 31.3]) {
        ray.set(W(-410, -280, y), W(1, 0, 0).normalize());
        const first = ray.intersectObjects(authored, false)[0];
        expect((first.object as T.Mesh<T.BufferGeometry, T.Material>).material.name).toMatch(/ribbon glass/);
    }
    const meshes: T.Mesh[] = [];
    additions.traverse(o => { if (o instanceof T.Mesh) meshes.push(o); });
    // Every tree on the parking roof must actually be supported by the original
    // podium, not by the bounding rectangle of its curved outline.
    for (const tree of meshes.filter(o => o.name.endsWith('fig_trunk') && o.position.y > 7)) {
        const p = tree.getWorldPosition(new T.Vector3()); p.y = 15; ray.set(p, down);
        const hit = ray.intersectObjects(authored, false)[0];
        expect(hit?.object.name, `podium tree ${tree.position.x},${tree.position.z}`).toBe('PHOTO_CC elevated podium deck');
        expect(tree.position.y - tree.scale.y / 2 - hit.point.y).toBeCloseTo(.01, 2);
    }
    for (let s = -480; s <= -410; s += 2) for (const t of [-396, -394, -392, -349]) {
        ray.set(W(s, t, 2), down);
        expect(ray.intersectObjects(meshes.filter(o => !o.name.endsWith('side_entrance_landing')), false), `clear passage ${s},${t}`).toHaveLength(0);
    }
    const triangles = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes['position'].count) / 3, 0);
    expect(triangles).toBeLessThan(150000);
    batchVenue(additions, () => null, () => 'static');
    expect(additions.children.length).toBeLessThan(20);
});

test('surface detailing: real model clearance, untouched buildings/roads, and bounded static geometry', () => {
    test.setTimeout(90_000);
    const root = suppliedGeometry();
    const meshes = root.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[];
    const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
    for (const [s, t] of PLAZA_PLANTERS) {
        // Check the whole bed plus surrounding clearance, including interior
        // samples that would catch a narrow road passing between its corners.
        for (let ds = -9; ds <= 9; ds += 3) for (let dt = -6; dt <= 6; dt += 3) {
            ray.set(new T.Vector3(.5 * (s + ds) + .8660254038 * (t + dt), 150,
                -.8660254038 * (s + ds) + .5 * (t + dt)), down);
            const hit = ray.intersectObjects(meshes, false)[0];
            expect(hit, `Ground under planter ${s},${t}, sample ${ds},${dt}`).toBeTruthy();
            expect(hit.point.y).toBeLessThan(.2);
            expect((hit.object as typeof meshes[number]).material.userData['architecturalCategory']).toBe('paved_ground');
        }
    }
    const authored = meshes.map(mesh => ({ mesh, positions: mesh.geometry.getAttribute('position'),
        index: mesh.geometry.index, uv: mesh.geometry.getAttribute('uv') }));
    prepareVenueSurfaceDetail(root);
    for (const { mesh, positions, index, uv } of authored) {
        if (mesh.material.userData['architecturalCategory'] === 'paved_ground') {
            expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(Array.from(positions.array));
            expect(Array.from(mesh.geometry.index?.array ?? [])).toEqual(Array.from(index?.array ?? []));
        } else {
            expect(mesh.geometry.getAttribute('position')).toBe(positions);
            expect(mesh.geometry.index).toBe(index);
            expect(mesh.geometry.getAttribute('uv'), mesh.name).toBe(uv);
        }
    }
    const additions = root.getObjectByName('SITE_DETAIL_decorative_planters') as T.Group;
    expect(additions.children.length).toBeGreaterThan(0);
    const triangles = additions.children.reduce((sum, object) => sum + (object as T.Mesh).geometry.index!.count / 3, 0);
    expect(triangles).toBeLessThan(3500);
    batchVenue(additions, () => null, () => 'static');
    expect(additions.children).toHaveLength(3); // stone, foliage, bark
});

test('ITPO office walkway: planters, bins and the clear walk all stand on the office paving', () => {
    test.setTimeout(90_000);
    const root = suppliedGeometry();
    const meshes = root.children as T.Mesh[];
    const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0);
    const paving = ['PHOTO_ADMIN office ground court', 'PHOTO_ADMIN office pedestrian apron'];
    const groundAt = (s: number, t: number, label: string) => {
        ray.set(new T.Vector3(.5 * s + .8660254038 * t, 150, -.8660254038 * s + .5 * t), down);
        const hit = ray.intersectObjects(meshes, false)[0];
        expect(hit, label).toBeTruthy();
        expect(hit.point.y, label).toBeLessThan(.2);
        expect(paving, label).toContain(hit.object.name);
    };
    const t = ITPO_WALKWAY_PLANTER_T;
    for (const [from, to] of ITPO_WALKWAY_RUNS) for (let s = from; s <= to; s += 1.5)
        for (const dt of [-.8, 0, .8]) groundAt(s, t + dt, `planter ${s},${t + dt}`);
    for (const s of ITPO_WALKWAY_BINS) groundAt(s, t - 2.2, `bin ${s}`);
    // The walk from 2 m off the office face (its roof cornice overhangs the first metre) to the planter.
    for (let s = ITPO_WALKWAY_RUNS[0][0]; s <= ITPO_WALKWAY_RUNS.at(-1)![1]; s += 3)
        for (let walk = t - 7.5; walk <= t - 1.5; walk += 1.5) groundAt(s, walk, `walk ${s},${walk}`);

    prepareVenueSurfaceDetail(root);
    const walkway = root.getObjectByName('SITE_EDGE_itpo_walkway') as T.Group;
    expect(walkway.children.filter(o => o.name === 'SITE_EDGE_itpo_lamp_pole')).toHaveLength(2);
    expect(walkway.children.filter(o => o.name === 'SITE_EDGE_itpo_bin')).toHaveLength(2);
});

test('photo-guided ITPO court and Gate 9 checkpoint fit the real ground and preserve circulation', () => {
    const root = suppliedGeometry(), authored = [...root.children] as T.Mesh[];
    addItpoExterior(root); root.updateMatrixWorld(true);
    const additions = root.getObjectByName('SITE_DETAIL_itpo_exterior') as T.Group;
    expect(additions).toBeTruthy();
    const down = new T.Vector3(0, -1, 0), ray = new T.Raycaster();
    const errors: string[] = [];
    // Sample the actual transformed footprint, including its interior. This
    // catches a rotated room/canopy or a kerb intruding onto the curved drive.
    additions.traverse(object => {
        if (!(object instanceof T.Mesh) || !/raised_planter|canopy_base|service_wall|checkpoint_plinth/.test(object.name)) return;
        object.geometry.computeBoundingBox(); const bounds = object.geometry.boundingBox!;
        for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) {
            const point = new T.Vector3(T.MathUtils.lerp(bounds.min.x, bounds.max.x, x / 4), 0,
                T.MathUtils.lerp(bounds.min.z, bounds.max.z, z / 4)).applyMatrix4(object.matrixWorld);
            point.y = 45; ray.set(point, down);
            const hit = ray.intersectObjects(authored, false)[0];
            if (!hit || hit.point.y > .16 || !/office ground court|office pedestrian apron/.test(hit.object.name))
                errors.push(`${object.name} ${x},${z}: ${hit?.object.name} @ ${hit?.point.y}`);
        }
    });
    expect(errors, 'Every footprint remains on office paving, away from roads, lawns and buildings').toEqual([]);
    const addedMeshes: T.Mesh[] = []; additions.traverse(o => { if (o instanceof T.Mesh) addedMeshes.push(o); });
    const W = (s: number, t: number) => new T.Vector3(.5 * s + .8660254038 * t, 2, -.8660254038 * s + .5 * t);
    // An uninterrupted walk along the office, and the gate centre's entry lane.
    for (let s = -480; s <= -405; s += 2) {
        ray.set(W(s, -386), down);
        expect(ray.intersectObjects(addedMeshes, false), `clear office walk at ${s}`).toHaveLength(0);
    }
    const nx = Math.sin(GATE9_CHECK_ROOM.angle), nt = Math.cos(GATE9_CHECK_ROOM.angle);
    for (let inward = -3; inward <= 18; inward += 1.5) for (const side of [-2, 0, 2]) {
        ray.set(W(-542.692 + nx * inward + nt * side, -363.315 + nt * inward - nx * side), down);
        expect(ray.intersectObjects(addedMeshes, false), `clear Gate 9 entry ${inward},${side}`).toHaveLength(0);
    }
    const triangles = addedMeshes.reduce((sum, m) => sum + (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, 0);
    expect(triangles).toBeLessThan(30000);
    batchVenue(additions, object => {
        for (let n: T.Object3D | null = object; n; n = n.parent) if (n.userData['gate_id']) return n.userData['gate_id'];
        return null;
    }, () => 'static');
    const batches: T.Mesh[] = []; additions.traverse(o => { if (o instanceof T.Mesh) batches.push(o); });
    expect(batches.length).toBeLessThan(35);
    expect(batches.some(o => o.userData['destinationId'] === 'gate9')).toBe(true);
    console.log({ itpoTriangles: triangles, itpoBatches: batches.length });
});
