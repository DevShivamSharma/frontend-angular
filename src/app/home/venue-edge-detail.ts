import * as T from 'three';

// Same metre-based campus axes as navigation. These bounds occupy the open
// forecourt recess without intersecting the supplied campus or mapped features.
export const FRONT_GARDEN = { minS: -40, maxS: 100, minT: 324, maxT: 376 } as const;
export const FRONT_GARDEN_TREES = [-22, 12, 48, 82].flatMap(s => [331, 369].map(t => [s, t] as const));
export const LEGACY_CONTEXT_ROADS = new Set([
    'PHOTO_ROADS_asphalt_network', 'PHOTO_ROADS_lane_markings', 'PHOTO_ROADS_perimeter_kerbs'
]);

export function isLegacyContextRoad(object: T.Object3D): boolean {
    return LEGACY_CONTEXT_ROADS.has(object.name.replaceAll(' ', '_'));
}

/** Swap only the duplicate exterior representation once the real local map is
 * ready. Campus drives, gate approaches, parking and their markings stay intact.
 */
export function revealMappedRoads(root: T.Object3D): void {
    root.traverse(object => { if (isLegacyContextRoad(object)) object.visible = false; });
}

export function addFrontGarden(root: T.Group): void {
    const materials = new Map<string, T.MeshStandardMaterial>();
    root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
            if (material instanceof T.MeshStandardMaterial) materials.set(material.name, material);
    });
    const paving = materials.get('REF_Supplied red Kota stone paving');
    const stone = materials.get('PM_Precinct limestone'), grass = materials.get('M_lawn');
    const leaves = materials.get('PM_Plaza planting'), bark = materials.get('PM_CC aerial tree bark');
    if (!paving || !stone || !grass || !leaves || !bark) return;
    const group = new T.Group(); group.name = 'SITE_EDGE_formal_front_garden';
    group.userData['decorative'] = true;
    const turf = grass.clone(); turf.vertexColors = true;
    const box = new T.BoxGeometry(1, 1, 1), crown = new T.IcosahedronGeometry(1, 1);
    crown.setIndex(Array.from({ length: crown.getAttribute('position').count }, (_, i) => i));
    const trunk = new T.CylinderGeometry(.2, .3, 4, 7);
    const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + .8660254038 * t, y, -.8660254038 * s + .5 * t);
    const add = (geometry: T.BufferGeometry, material: T.Material, name: string,
        s: number, t: number, y: number, scale: [number, number, number]) => {
        const mesh = new T.Mesh(geometry, material); mesh.name = name;
        mesh.position.copy(W(s, t, y)); mesh.rotation.y = Math.PI / 3; mesh.scale.set(...scale); group.add(mesh);
    };
    // Pave only the paths, leaving real holes for turf. A full slab underneath
    // coplanar grass flickers at overview distances because of depth precision.
    for (const [t, depth] of [[325.5, 3], [350, 6], [374.5, 3]])
        add(box, paving, 'SITE_EDGE_garden_paving', 30, t, .02, [140, .12, depth]);
    for (const [s, width] of [[-38.5, 3], [30, 8], [98.5, 3]])
        add(box, paving, 'SITE_EDGE_garden_paving', s, 350, .02, [width, .12, 46]);
    // Four equal panels frame a clear cross path; both axes and both tree rows
    // are mirrored about the same garden centre, rather than scattered props.
    for (const s of [-5.5, 65.5]) for (const t of [337, 363]) {
        for (const edge of [-31, 31]) add(box, stone, 'SITE_EDGE_garden_kerb', s + edge, t, .12, [1, .2, 20]);
        for (const edge of [-9.5, 9.5]) add(box, stone, 'SITE_EDGE_garden_kerb', s, t + edge, .12, [61, .2, 1]);
        for (let stripe = 0; stripe < 6; stripe++) {
            const geometry = new T.PlaneGeometry(61 / 6, 18); geometry.rotateX(-Math.PI / 2);
            const shade = (s < 30 ? stripe : 5 - stripe) % 2 ? 1 : .92;
            geometry.setAttribute('color', new T.Float32BufferAttribute(Array(4).fill([shade, shade, shade]).flat(), 3));
            add(geometry, turf, 'SITE_EDGE_garden_lawns', s - 30.5 + (stripe + .5) * 61 / 6, t, .18, [1, 1, 1]);
        }
    }
    for (const [s, t] of FRONT_GARDEN_TREES) {
        add(trunk, bark, 'SITE_EDGE_garden_tree_trunk', s, t, 2.2, [1, 1, 1]);
        add(crown, leaves, 'SITE_EDGE_garden_tree_crown', s, t, 5.6, [2.6, 3, 2.4]);
        add(crown, leaves, 'SITE_EDGE_garden_tree_crown', s + .7, t + .4, 4.8, [2.1, 2.2, 2]);
        add(box, stone, 'SITE_EDGE_garden_seat', s, t < 350 ? t + 3.8 : t - 3.8, .52, [3.4, .6, .85]);
    }
    root.add(group);
}
