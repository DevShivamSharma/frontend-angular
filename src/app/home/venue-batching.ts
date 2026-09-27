import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One-time, lossless batching. Transparent surfaces retain their individual sort order.
 * Keep destination, highlight, clipping and shadow semantics separate, including occluders.
 * No simplification, texture resampling or per-frame geometry work.
 */
export function batchVenue(root: T.Group, classify: (object: T.Object3D) => string | null,
    semantics: (object: T.Mesh) => string): void {
    root.updateMatrixWorld(true);
    const inverseRoot = root.matrixWorld.clone().invert();
    const bins = new Map<string, T.Mesh[]>();
    root.traverse(object => {
        if (!(object instanceof T.Mesh) || object instanceof T.SkinnedMesh || object.children.length ||
            Array.isArray(object.material) || object.material.transparent || object.morphTargetInfluences) return;
        for (let node: T.Object3D | null = object; node; node = node.parent)
            if (node.userData['cc_level'] || /^(OUTER_GROUND|CONTEXT_GROUND)$/.test(node.name)) return;
        const geometry = object.geometry;
        const attributes = Object.entries(geometry.attributes as Record<string, T.BufferAttribute>).map(([key, a]) =>
            `${key}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(',');
        const key = [object.material.uuid, classify(object), semantics(object), attributes, !!geometry.index].join('|');
        const bin = bins.get(key) ?? [];
        bin.push(object); bins.set(key, bin);
    });
    const removed = new Set<T.BufferGeometry>();
    for (const meshes of bins.values()) {
        if (meshes.length < 2) continue;
        const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(
            new T.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld)));
        const geometry = mergeGeometries(geometries, false);
        geometries.forEach(g => g.dispose());
        if (!geometry) continue;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const first = meshes[0], batch = new T.Mesh(geometry, first.material);
        batch.name = first.name;
        batch.userData = { ...first.userData, destinationId: classify(first),
            batchSources: meshes.map(mesh => mesh.name) };
        root.add(batch);
        for (const mesh of meshes) { removed.add(mesh.geometry); mesh.removeFromParent(); }
    }
    // Some glTF instances still reference a source geometry; release only unused buffers.
    root.traverse(object => { if (object instanceof T.Mesh) removed.delete(object.geometry); });
    removed.forEach(geometry => geometry.dispose());
}
