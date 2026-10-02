import * as T from 'three';

// Same metre-based campus axes as navigation. These bounds occupy the open
// forecourt recess without intersecting the supplied campus or mapped features.
export const FRONT_GARDEN = { minS: -40, maxS: 100, minT: 324, maxT: 376 } as const;
export const FRONT_GARDEN_TREES = [-22, 12, 48, 82].flatMap(s => [331, 369].map(t => [s, t] as const));
// The ITPO office's east walkway, as photographed on site: an ~8.5 m paved walk along the
// building, then a long raised concrete planter (hedge, fiddle-leaf figs, street lamps) with
// green bins at the crossings. Campus axes; the office's east face is at t = -353.5. Each run,
// bin and the clear walk were checked against the model's own ground triangles: all on
// "PHOTO_ADMIN office ground court" / "pedestrian apron" paving, clear of lawns and roads.
export const ITPO_WALKWAY_PLANTER_T = -344;
export const ITPO_WALKWAY_RUNS: readonly (readonly [number, number])[] = [[-478, -453], [-450.5, -426], [-423.5, -400]];
export const ITPO_WALKWAY_BINS: readonly number[] = [-480.5, -451.75, -424.75];
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

/** The planted strip along the ITPO office walkway (see ITPO_WALKWAY_RUNS). Reuses the
 * model's own materials, so both palettes and the static batching treat it like the
 * supplied landscape; only the bins get their own green.
 */
export function addItpoWalkway(root: T.Group): void {
    const materials = new Map<string, T.MeshStandardMaterial>();
    root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
            if (material instanceof T.MeshStandardMaterial) materials.set(material.name, material);
    });
    const concrete = materials.get('PM_Precinct limestone'), coping = materials.get('SITE_ADMIN ivory coping');
    const hedge = materials.get('PM_Plaza planting'), figs = materials.get('SITE_ADMIN foliage 0');
    const bark = materials.get('SITE_ADMIN tree bark');
    const metal = materials.get('DETAIL luminaire graphite metal'), lamp = materials.get('DETAIL warm luminaire diffuser');
    if (!concrete || !coping || !hedge || !figs || !bark || !metal || !lamp) return;
    const bin = new T.MeshStandardMaterial({ name: 'SITE_ITPO walkway bin green', color: 0x1f5c34, roughness: .55 });
    const group = new T.Group(); group.name = 'SITE_EDGE_itpo_walkway';
    group.userData['decorative'] = true;
    const box = new T.BoxGeometry(1, 1, 1), crown = new T.IcosahedronGeometry(1, 1);
    crown.setIndex(Array.from({ length: crown.getAttribute('position').count }, (_, i) => i));
    const stem = new T.CylinderGeometry(.06, .09, 1.6, 6), pole = new T.CylinderGeometry(.09, .13, 9, 8);
    const drum = new T.CylinderGeometry(.28, .25, .85, 12), lid = new T.CylinderGeometry(.3, .3, .06, 12);
    const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + .8660254038 * t, y, -.8660254038 * s + .5 * t);
    const add = (geometry: T.BufferGeometry, material: T.Material, name: string,
        s: number, t: number, y: number, scale: [number, number, number]) => {
        const mesh = new T.Mesh(geometry, material); mesh.name = name;
        mesh.position.copy(W(s, t, y)); mesh.rotation.y = Math.PI / 3; mesh.scale.set(...scale); group.add(mesh);
    };
    const t = ITPO_WALKWAY_PLANTER_T, ground = .05;
    for (const [from, to] of ITPO_WALKWAY_RUNS) {
        const length = to - from, mid = (from + to) / 2;
        // Concrete box with a pale coping, the hedge filling it to about 1.25 m.
        add(box, concrete, 'SITE_EDGE_itpo_planter', mid, t, ground + .275, [length, .55, 1.6]);
        add(box, coping, 'SITE_EDGE_itpo_planter_coping', mid, t, ground + .59, [length + .1, .08, 1.7]);
        add(box, hedge, 'SITE_EDGE_itpo_hedge', mid, t, ground + .95, [length - .3, .65, 1.25]);
        // Fig shrubs every ~5 m above the hedge; the lamp stands in the gap at mid-run.
        for (let s = from + 2.5; s < to - 1; s += 5) {
            if (Math.abs(s - mid) < 2) continue;
            const tall = Math.round((s - from) / 5) % 2 ? .35 : 0;
            add(stem, bark, 'SITE_EDGE_itpo_fig_stem', s, t, ground + 1.4 + tall / 2, [1, 1 + tall, 1]);
            add(crown, figs, 'SITE_EDGE_itpo_fig_crown', s, t, ground + 2.2 + tall, [.75, .95, .7]);
            add(crown, figs, 'SITE_EDGE_itpo_fig_crown', s + .3, t - .2, ground + 1.75 + tall, [.6, .6, .55]);
        }
        // A tall street lamp, its head reaching out over the walk (towards the office, -t).
        add(pole, metal, 'SITE_EDGE_itpo_lamp_pole', mid, t, ground + .6 + 4.5, [1, 1, 1]);
        add(box, metal, 'SITE_EDGE_itpo_lamp_arm', mid, t - .7, ground + 9.6, [.12, .12, 1.5]);
        add(box, lamp, 'SITE_EDGE_itpo_lamp_light', mid, t - 1.3, ground + 9.5, [.32, .1, .55]);
    }
    // Green bins on the walk side of each planter run's start.
    for (const s of ITPO_WALKWAY_BINS) {
        add(drum, bin, 'SITE_EDGE_itpo_bin', s, t - 2.2, ground + .425, [1, 1, 1]);
        add(lid, bin, 'SITE_EDGE_itpo_bin_lid', s, t - 2.2, ground + .88, [1, 1, 1]);
    }
    root.add(group);
}
