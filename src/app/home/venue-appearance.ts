import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPavingTexture } from './venue-surface-detail';

export type VenueAppearance = 'natural' | 'color';
/** Ground context shown under the Color appearance. */
export type VenueScenery = 'satellite' | 'map';

/** The supplied palette has materials/textures only. Never attach a second scene.
 * Keep material instances stable for selection, clipping and the static batches.
 */
export function createVenueAppearance(root: T.Group, renderer: T.WebGLRenderer,
    asset: (path: string) => string, signal: AbortSignal) {
    const surfaces = new Map<T.MeshStandardMaterial, T.MeshStandardMaterial>();
    const ownedMaterials = new Set<T.Material>(), textures = new Set<T.Texture>();
    let disposed = false;
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    let naturalPaving: T.Texture | undefined;
    const own = (material: T.Material) => {
        ownedMaterials.add(material);
        for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    };
    root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!(material instanceof T.MeshStandardMaterial) || surfaces.has(material)) continue;
            if (material.userData['architecturalCategory'] === 'paved_ground') {
                naturalPaving ??= createPavingTexture(null, anisotropy);
                material.map = naturalPaving;
                material.color.setRGB(.20, .218, .213);
                renderer.initTexture(naturalPaving);
            }
            const natural = material.clone(); surfaces.set(material, natural); own(natural);
        }
    });
    const wanted = new Set([...surfaces.values()]
        .filter(m => m.userData['architecturalCategory'] !== 'supplied_floor_plan').map(m => m.name));
    let pending: Promise<Map<string, T.MeshStandardMaterial>> | undefined;
    async function loadPalette() {
        const response = await fetch(asset('venue-colour-materials.glb?v=colour-20260927-r1'), { signal });
        if (!response.ok) throw Error('Color materials unavailable');
        const bytes = await response.arrayBuffer(); signal.throwIfAborted();
        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        // Loading dependencies individually avoids decoding duplicate floor-plan PNGs.
        const definitions = gltf.parser.json.materials as { name: string }[];
        const materials = await Promise.allSettled(definitions.flatMap((definition, index) =>
            wanted.has(definition.name) ? [gltf.parser.getDependency('material', index)] : []));
        const palette = new Map<string, T.MeshStandardMaterial>();
        let failed = false;
        for (const result of materials) {
            if (result.status === 'rejected') { failed = true; continue; }
            const material = result.value as T.MeshStandardMaterial;
            // Keep ownership of the supplied texture even after composing its
            // image into the plaza atlas, so inactive palettes also clean up.
            own(material);
            if (material.userData['architecturalCategory'] === 'paved_ground')
                material.map = createPavingTexture(material.map, anisotropy);
            own(material); palette.set(material.name, material);
            for (const value of Object.values(material)) if (value instanceof T.Texture) {
                value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
                // Upload before applying the palette, so movement doesn't reveal late textures.
                if (!signal.aborted && !disposed) renderer.initTexture(value);
            }
        }
        if (signal.aborted || disposed) { dispose(); signal.throwIfAborted(); throw Error('Viewer disposed'); }
        if (failed) throw Error('Some color textures could not load');
        return palette;
    }
    function dispose() {
        disposed = true;
        // This controller owns both cached palettes, even when one isn't active.
        // Detach their textures before the main scene performs its general cleanup.
        for (const material of surfaces.keys()) {
            const properties = material as unknown as Record<string, unknown>;
            for (const [key, value] of Object.entries(properties))
                if (value instanceof T.Texture && textures.has(value)) properties[key] = null;
        }
        const bitmaps = new Set<ImageBitmap>();
        for (const texture of textures) {
            texture.dispose();
            if (typeof ImageBitmap !== 'undefined' && texture.source?.data instanceof ImageBitmap)
                bitmaps.add(texture.source.data);
        }
        bitmaps.forEach(image => image.close()); textures.clear();
        ownedMaterials.forEach(material => material.dispose()); ownedMaterials.clear();
    }
    return {
        async apply(mode: VenueAppearance) {
            signal.throwIfAborted();
            const palette = mode === 'color' ? await (pending ??= loadPalette().catch(error => {
                pending = undefined; throw error;
            })) : null;
            signal.throwIfAborted();
            for (const [material, natural] of surfaces) {
                const source = palette?.get(natural.name) ?? natural;
                const { vertexColors, flatShading, clippingPlanes, side } = material;
                material.copy(source);
                Object.assign(material, { vertexColors, flatShading, clippingPlanes, side });
                material.needsUpdate = true;
            }
        },
        dispose
    };
}
