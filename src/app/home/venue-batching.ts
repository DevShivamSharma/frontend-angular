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
        if (!(object instanceof T.Mesh) || object instanceof T.SkinnedMesh || object instanceof T.InstancedMesh || object.children.length ||
            Array.isArray(object.material) || object.material.transparent || object.morphTargetInfluences) return;
        for (let node: T.Object3D | null = object; node; node = node.parent)
            // A hidden source layer must stay under its hidden parent. Moving
            // its children into a visible batch resurrects obsolete floor and
            // garden triangles through the replacement paving.
            if (!node.visible || node.userData['cc_level'] || node.userData['interiorRoof'] || node.userData['dynamicGate9'] || node.userData['contextGround'] || /^(OUTER_GROUND|CONTEXT_GROUND)$/.test(node.name)) return;
        const geometry = object.geometry;
        // Positions all become floats when merged (floatPositions), whatever their stored type.
        const attributes = Object.entries(geometry.attributes as Record<string, T.BufferAttribute>).map(([key, a]) =>
            key === 'position' ? 'position:3' : `${key}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(',');
        const key = [object.material.uuid, classify(object), semantics(object), object.visible, attributes, !!geometry.index].join('|');
        const bin = bins.get(key) ?? [];
        bin.push(object); bins.set(key, bin);
    });
    const removed = new Set<T.BufferGeometry>(), merged = new Set<T.Object3D>();
    for (const meshes of bins.values()) {
        if (meshes.length < 2) continue;
        const geometries = meshes.map(mesh => floatPositions(mesh.geometry.clone()).applyMatrix4(
            new T.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld)));
        const geometry = mergeGeometries(geometries, false);
        geometries.forEach(g => g.dispose());
        if (!geometry) continue;
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const first = meshes[0], batch = new T.Mesh(geometry, first.material);
        batch.visible = first.visible;
        batch.name = first.name;
        batch.userData = { ...first.userData, destinationId: classify(first),
            batchSources: meshes.map(mesh => mesh.name) };
        root.add(batch);
        for (const mesh of meshes) { removed.add(mesh.geometry); merged.add(mesh); }
    }
    // One pass per parent: removing tens of thousands of children one by one is quadratic.
    for (const parent of new Set([...merged].map(mesh => mesh.parent!))) {
        parent.children = parent.children.filter(child => !merged.has(child));
        for (const child of merged) if (child.parent === parent) { child.parent = null; child.dispatchEvent({ type: 'removed' }); }
    }
    // Some glTF instances still reference a source geometry; release only unused buffers.
    root.traverse(object => { if (object instanceof T.Mesh) removed.delete(object.geometry); });
    removed.forEach(geometry => geometry.dispose());
}

/** Quantized (KHR_mesh_quantization) positions are integers dequantized by the node transform; once that transform
 * is baked in they leave the integer range, so they become floats first. Normalized normals stay as they are. */
function floatPositions(geometry: T.BufferGeometry): T.BufferGeometry {
    const position = geometry.getAttribute('position') as T.BufferAttribute | T.InterleavedBufferAttribute;
    if (position.array instanceof Float32Array && !position.normalized && !(position instanceof T.InterleavedBufferAttribute)) return geometry;
    // Quantized positions are interleaved with padding (stride 4 for a VEC3 of Int16).
    const interleaved = position instanceof T.InterleavedBufferAttribute;
    const source = position.array, stride = interleaved ? position.data.stride : position.itemSize, offset = interleaved ? position.offset : 0;
    // glTF normalized integers: v / max, clamped at -1 for the signed minimum (as BufferAttribute.getX does).
    const scale = !position.normalized ? 1 : source instanceof Int16Array ? 1 / 32767 : source instanceof Int8Array ? 1 / 127 :
        source instanceof Uint16Array ? 1 / 65535 : source instanceof Uint8Array ? 1 / 255 : 1;
    const array = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) for (let k = 0; k < 3; k++)
        array[i * 3 + k] = Math.max(source[i * stride + offset + k] * scale, -1);
    geometry.setAttribute('position', new T.BufferAttribute(array, 3));
    return geometry;
}
