import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as T from 'three';
import { batchVenue } from '../src/app/home/venue-batching';
import { PLAZA_PLANTERS, prepareVenueSurfaceDetail } from '../src/app/home/venue-surface-detail';

// Decode the supplied geometry without a browser or texture/network mocks.
// This verifies placement against every actual visible obstacle, not a copied
// rectangle or a list of assumed building names.
function suppliedGeometry() {
    const bytes = readFileSync('outputs/outputs/IITF_2026_ARCHITECTURAL.glb');
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
