import * as T from 'three';
import { addFrontGarden, addItpoWalkway, addGate6Road } from './venue-edge-detail';
import { addItpoExterior } from './venue-itpo-exterior';

const PAVING_REPEAT_METRES = 32;
// Decorative additions, not surveyed venue features. Each bed and its clearance
// were checked against the supplied model's actual ground triangles, not its AABB.
export const PLAZA_PLANTERS: readonly (readonly [number, number])[] = [
    [-10, -40], [35, -40], [125, -40], [20, 85], [65, 85], [110, 85], [155, 85]
];

/** One-time preparation before the existing lossless batching pass. */
export function prepareVenueSurfaceDetail(root: T.Group): void {
    addFrontGarden(root);
    addItpoWalkway(root);
    addItpoExterior(root);
    addGate6Road(root);
    root.updateMatrixWorld(true);
    const materials = new Map<string, T.MeshStandardMaterial>();
    const replaced = new Set<T.BufferGeometry>();
    const point = new T.Vector3();
    root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of mats) if (mat instanceof T.MeshStandardMaterial) materials.set(mat.name, mat);
        // glTF primitives already separate the authored paving from roofs, roads,
        // lawns and floor plans. Preserve every boundary, triangle and other UV set.
        if (mats.length !== 1 || mats[0].userData['architecturalCategory'] !== 'paved_ground') return;
        const source = object.geometry as T.BufferGeometry;
        const geometry = object.geometry = source.clone();
        replaced.add(source);
        const positions = geometry.getAttribute('position');
        const uv = new Float32Array(positions.count * 2);
        for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
            // Align the stone coursing to the same surveyed campus axes as W().
            uv[i * 2] = (.5 * point.x - .8660254038 * point.z) / PAVING_REPEAT_METRES;
            uv[i * 2 + 1] = (.8660254038 * point.x + .5 * point.z) / PAVING_REPEAT_METRES;
        }
        geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    });
    // Shared box/source buffers can still belong to stone or planting meshes.
    // Release only unused originals, without changing those other materials' UVs.
    root.traverse(object => { if (object instanceof T.Mesh) replaced.delete(object.geometry); });
    replaced.forEach(geometry => geometry.dispose());

    const stone = materials.get('PM_Precinct limestone');
    const leaves = materials.get('PM_Plaza planting');
    const bark = materials.get('PM_CC aerial tree bark');
    if (!stone || !leaves || !bark) return;
    // Reuse the model's material identities so both supplied palettes work, and
    // let batchVenue merge these static pieces. No individual render/update loop.
    const box = new T.BoxGeometry(1, 1, 1);
    const crown = new T.IcosahedronGeometry(1, 1);
    // Match the other pieces' indexed layout so all foliage forms one batch.
    crown.setIndex(Array.from({ length: crown.getAttribute('position').count }, (_, i) => i));
    const trunk = new T.CylinderGeometry(.15, .23, 2.8, 7);
    const group = new T.Group(); group.name = 'SITE_DETAIL_decorative_planters';
    const add = (geometry: T.BufferGeometry, material: T.Material, name: string,
        position: T.Vector3, scale: [number, number, number], angle = Math.PI / 3) => {
        const mesh = new T.Mesh(geometry, material); mesh.name = name;
        mesh.position.copy(position); mesh.scale.set(...scale); mesh.rotation.y = angle;
        group.add(mesh);
    };
    const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + .8660254038 * t, y, -.8660254038 * s + .5 * t);
    for (const [s, t] of PLAZA_PLANTERS) {
        add(box, stone, 'SITE_DETAIL_planter_stone', W(s, t, .38), [9, .7, 3.8]);
        add(box, leaves, 'SITE_DETAIL_planter_low_planting', W(s, t, .82), [8.3, .4, 3.1]);
        for (const offset of [-2.7, 2.7]) {
            add(trunk, bark, 'SITE_DETAIL_planter_tree_trunk', W(s + offset, t, 2.05), [1, 1, 1]);
            add(crown, leaves, 'SITE_DETAIL_planter_tree_crown', W(s + offset, t, 4.15), [1.7, 2.1, 1.6]);
            add(crown, leaves, 'SITE_DETAIL_planter_tree_crown', W(s + offset + .65, t + .35, 3.75), [1.4, 1.5, 1.35], .3);
        }
    }
    root.add(group);
}

/** A cached, mipmapped stone atlas. Color mode retains the supplied Kota image
 * inside the same coursing; Natural draws the campus's own paving as the z19
 * satellite shows it. Created once per palette, uploaded before display and
 * owned by the appearance controller.
 */
export function createPavingTexture(source: T.Texture | null, anisotropy: number): T.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    const image = source?.image as CanvasImageSource | undefined;
    if (image) {
        // Eight-metre bays keep a readable rhythm at overview distance.
        ctx.fillStyle = '#a9a298'; ctx.fillRect(0, 0, 1024, 1024);
        for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
            const x = column * 256, y = row * 256;
            ctx.drawImage(image, x + 5, y + 5, 246, 246);
            ctx.fillStyle = `rgba(245,238,221,${.025 + ((row * 3 + column) % 4) * .025})`;
            ctx.fillRect(x + 5, y + 5, 246, 246);
        }
        // A restrained inset border every 32 m breaks up the largest open plazas.
        ctx.strokeStyle = '#8b8175'; ctx.lineWidth = 9;
        ctx.strokeRect(17, 17, 990, 990);
    } else drawNaturalPaving(ctx);
    const texture = new T.CanvasTexture(canvas);
    texture.name = image ? 'Plaza stone / supplied Kota' : 'Plaza stone / natural';
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
}

/** The campus paving as the z19 photo shows it: pale warm granite in 0.6 m squares, a faded red
 * sandstone band on a 32 m grid (the central plaza's lattice) and soft weathering, so the repeat
 * doesn't read as a pattern. 32 px a metre; the band runs along two edges and meets its repeat.
 */
function drawNaturalPaving(ctx: CanvasRenderingContext2D): void {
    let seed = 7;
    const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const band = 40, tiles = 50, size = (1024 - band) / tiles;
    const cell = (x: number, y: number, w: number, h: number) => {
        const left = Math.round(x), top = Math.round(y);
        ctx.fillRect(left + 1, top + 1, Math.round(x + w) - left - 1, Math.round(y + h) - top - 1);
    };
    // The joint colour shows through the 1 px gap each stone leaves.
    ctx.fillStyle = '#a49b8c'; ctx.fillRect(0, 0, 1024, 1024);
    for (let row = 0; row < tiles; row++) for (let column = 0; column < tiles; column++) {
        const tone = 198 + random() * 16, warm = random() * 6;
        ctx.fillStyle = `rgb(${tone + warm | 0},${tone - 4 | 0},${tone - 16 - warm | 0})`;
        cell(band + column * size, band + row * size, size, size);
    }
    // Two courses of sandstone slabs in the band.
    ctx.fillStyle = '#8e6a5b'; ctx.fillRect(0, 0, 1024, band); ctx.fillRect(0, 0, band, 1024);
    for (let i = 0; i < 1024 / size; i++) for (const course of [0, band / 2]) {
        for (const vertical of [false, true]) {
            const tone = 172 + random() * 18;
            ctx.fillStyle = `rgb(${tone | 0},${tone * .7 | 0},${tone * .58 | 0})`;
            if (vertical) { if (i * size >= band) cell(course, i * size, band / 2, size); }
            else cell(i * size, course, size, band / 2);
        }
    }
    // Weathering: wide, faint patches drawn again across each edge so the tile stays seamless.
    for (let i = 0; i < 46; i++) {
        const x = random() * 1024, y = random() * 1024, r = 40 + random() * 150, dark = random() < .6;
        for (const dx of [-1024, 0, 1024]) for (const dy of [-1024, 0, 1024]) {
            if (x + dx + r < 0 || x + dx - r > 1024 || y + dy + r < 0 || y + dy - r > 1024) continue;
            const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            gradient.addColorStop(0, dark ? 'rgba(92,82,66,.075)' : 'rgba(255,250,238,.07)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
        }
    }
}
