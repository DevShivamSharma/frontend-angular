import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPavingTexture } from './venue-surface-detail';
import { createArchitecturalFinishes } from './venue-architectural-detail';

export type VenueAppearance = 'natural' | 'color';
/** Ground context shown under the Color appearance. */
export type VenueScenery = 'satellite' | 'map';
/** What the explorer opens on: Color with modeled, satellite-registered surroundings. */
export const INITIAL_APPEARANCE: VenueAppearance = 'color', INITIAL_SCENERY: VenueScenery = 'map';
/** The Color palette with its textures as JPEG (scripts/compress-venue-palette.py from venue-colour-materials.glb). */
export const COLOUR_MATERIALS = 'venue-colour-materials-web.glb?v=colour-20260927-r1';

/** Color → Map finishes of the surroundings layer, by material name (venue-site-detail.glb; the
 * asphalt keeps the Gate 9 texture, tinted by road class). Natural and Color → Satellite keep theirs. */
const MAP_FINISHES: [RegExp, string][] = [
    [/SITE_ROAD weathered asphalt arterial$/, '#858782'],
    [/SITE_ROAD weathered asphalt local$/, '#999a92'],
    [/SITE_ROAD weathered asphalt$/, '#b1ac9d'],
    [/^SITE_ROAD clipped groundcover$/, '#5d8f3e'],
    [/^SITE_ROAD warm concrete footpaths$/, '#d6cfc0'],
    [/^SITE_ROAD pale kerb stone$/, '#ebe8df'],
    [/^SITE_ROAD pale sandstone walkways$/, '#e1d1b2'],
    [/^SITE surrounding planted ground$/, '#2e5226']
];

/** The supplied palette has materials/textures only. Never attach a second scene.
 * Keep material instances stable for selection, clipping and the static batches.
 */
export function createVenueAppearance(root: T.Group, renderer: T.WebGLRenderer,
    asset: (path: string) => string, signal: AbortSignal) {
    const surfaces = new Map<T.MeshStandardMaterial, T.MeshStandardMaterial>();
    const ownedMaterials = new Set<T.Material>(), textures = new Set<T.Texture>();
    let disposed = false;
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const architecture = createArchitecturalFinishes(anisotropy);
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
                // The texture carries the stone; this sets its brightness, a touch warm as in the photo.
                material.color.setRGB(.63, .6, .55);
                // The 1 px joints read as shallow grooves up close; the Color palette has no bump map.
                material.bumpMap = naturalPaving; material.bumpScale = .02;
                renderer.initTexture(naturalPaving);
            }
            architecture.apply(material, true);
            const natural = material.clone(); surfaces.set(material, natural); own(natural);
        }
    });
    for (const texture of architecture.textures) { textures.add(texture); renderer.initTexture(texture); }
    const wanted = new Set([...surfaces.values()]
        .filter(m => m.userData['architecturalCategory'] !== 'supplied_floor_plan').map(m => m.name));
    let pending: Promise<Map<string, T.MeshStandardMaterial>> | undefined;
    async function loadPalette() {
        const response = await fetch(asset(COLOUR_MATERIALS), { signal });
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
        async apply(mode: VenueAppearance, scenery: VenueScenery = 'satellite') {
            signal.throwIfAborted();
            const palette = mode === 'color' ? await (pending ??= loadPalette().catch(error => {
                pending = undefined; throw error;
            })) : null;
            signal.throwIfAborted();
            const map = mode === 'color' && scenery === 'map';
            for (const [material, natural] of surfaces) {
                const source = palette?.get(natural.name) ?? natural;
                const { vertexColors, flatShading, clippingPlanes, side } = material;
                material.copy(source);
                Object.assign(material, { vertexColors, flatShading, clippingPlanes, side });
                architecture.apply(material, mode === 'natural', architecture.finishOf(natural));
                const finish = map && MAP_FINISHES.find(([name]) => name.test(natural.name));
                if (finish) material.color.set(finish[1]);
                material.needsUpdate = true;
            }
        },
        dispose
    };
}
