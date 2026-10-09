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

// Gate 6 frontage registered to the bundled satellite's visible road, rather
// than the approximate OSM frame. Inner-image centreline pixels (1323,1240) and
// (1314,1470) map to world X/Z (-239.12,363.54) and (264.81,366.70).
// Widths remain physical metres; the user confirmed 3+3 lanes.
export const GATE6_ROAD = {
    from: -120, to: 450, gate: 151, centreS: -306.4, drift: -.00627,
    lanes: 3, laneWidth: 3.5, medianWidth: 6, footpathWidth: 2.5,
    medianBreak: [120, 174] as const, crossing: 106,
    shelters: [[-100, 95], [270, 427]] as const
} as const;

/** Static frontage only: no vehicle simulation, lights, remote assets or frame work. */
export function addGate6Road(root: T.Group): void {
    if (root.getObjectByName('SITE_EDGE_gate6_road')) return;
    const group = new T.Group(); group.name = 'SITE_EDGE_gate6_road';
    // This shared scene group is used in Natural, Color/Map and Satellite.
    group.rotation.y = Math.PI / 2;
    group.position.set(-148, 0, 58.1);
    group.userData['photoGuided'] = true;
    group.userData['laneCount'] = [3, 3];
    root.add(group);
    const r = GATE6_ROAD, halfMedian = r.medianWidth / 2;
    const roadEdge = halfMedian + r.lanes * r.laneWidth;
    const centre = (t: number) => r.centreS + r.drift * (t - r.gate);
    const material = (name: string, color: number, category: string, roughness = .9) => {
        const mat = new T.MeshStandardMaterial({ name: `SITE_GATE6 ${name}`, color, roughness });
        mat.userData['architecturalCategory'] = category;
        return mat;
    };
    const asphalt = material('rough asphalt', 0x414446, 'road', .98);
    const paving = material('pale concrete pavers', 0xbdb7a9, 'road_footpath');
    const white = material('worn ivory road paint', 0xc7c5b7, 'road_marking');
    const kerbWhite = material('limestone kerb', 0xc4c1b6, 'road_kerb');
    const kerbBlack = material('charcoal kerb', 0x353836, 'road_kerb');
    const grass = material('grass verge', 0x526747, 'landscape');
    const foliage = material('tree foliage', 0x40583a, 'landscape');
    const bark = material('tree bark', 0x665948, 'landscape');
    const steel = material('graphite street furniture', 0x444c49, 'road_furniture', .65);
    const cream = material('cream shelter roof', 0xd5d2bc, 'road_shelter');
    cream.side = T.DoubleSide;
    const blue = material('blue direction panels', 0x236295, 'road_sign');
    const yellow = material('yellow movable barriers', 0xcaa52f, 'road_furniture');
    const diffuser = material('streetlight glass', 0xddd9bf, 'road_furniture', .5);

    // Small deterministic native textures, shared for the whole road. World UVs
    // give metre-scale aggregate and slab joints, without external bitmap assets.
    function surfaceTexture(kind: 'asphalt' | 'pavers' | 'paint') {
        const size = 128, data = new Uint8Array(size * size * 4);
        let seed = 37;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            let shade = 218 + (seed >>> 27);
            if (kind === 'pavers' && (y % 32 < 1 || (x + (Math.floor(y / 32) % 2) * 32) % 64 < 1)) shade = 158;
            if (kind === 'paint' && (seed & 63) < 6) shade = 90;
            const i = (y * size + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = shade; data[i + 3] = 255;
        }
        const texture = new T.DataTexture(data, size, size);
        texture.colorSpace = T.SRGBColorSpace;
        texture.wrapS = texture.wrapT = T.RepeatWrapping;
        texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter;
        texture.generateMipmaps = true; texture.needsUpdate = true;
        return texture;
    }
    asphalt.map = surfaceTexture('asphalt');
    paving.map = surfaceTexture('pavers');
    white.map = surfaceTexture('paint');
    const box = new T.BoxGeometry(1, 1, 1), cylinder = new T.CylinderGeometry(1, 1, 1, 7);
    const crown = new T.IcosahedronGeometry(1, 1);
    const instances = new Map<string, { geometry: T.BufferGeometry; material: T.Material; matrices: T.Matrix4[] }>();
    const transform = new T.Object3D();
    function repeated(name: string, geometry: T.BufferGeometry, mat: T.Material,
        s: number, t: number, y: number, size: [number, number, number], angle = 0) {
        const bin = instances.get(name) ?? { geometry, material: mat, matrices: [] };
        transform.position.set(s, y, t); transform.rotation.set(0, angle, 0); transform.scale.set(...size);
        transform.updateMatrix(); bin.matrices.push(transform.matrix.clone()); instances.set(name, bin);
    }
    function strip(name: string, from: number, to: number, low: number, high: number, y: number, mat: T.Material) {
        return polygon(name, [[centre(from) + low, from], [centre(from) + high, from],
            [centre(to) + high, to], [centre(to) + low, to]], y, mat);
    }
    function polygon(name: string, points: number[][], y: number, mat: T.Material) {
        const shape = new T.Shape(points.map(([s, t]) => new T.Vector2(s, -t)));
        const geometry = new T.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
        const pos = geometry.getAttribute('position'), uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / 2; uv[i * 2 + 1] = pos.getZ(i) / 2; }
        geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
        const mesh = new T.Mesh(geometry, mat); mesh.position.y = y;
        mesh.name = `SITE_GATE6_${name}`; group.add(mesh); return mesh;
    }

    // One continuous road beneath the median openings, on the satellite's
    // Mathura Road centreline. Do not rotate the backdrop to hide a mismatch.
    // Above the old 0.19 m promenade inlay, below the 0.38 m kerb tops.
    strip('asphalt', r.from, r.to, -roadEdge, roadEdge, .205, asphalt);
    for (const side of [-1, 1]) {
        const near = side * roadEdge, far = side * (roadEdge + r.footpathWidth);
        strip('footpath_paving', r.from, r.to, Math.min(near, far), Math.max(near, far), .36, paving);
        strip('grass_verge', r.from, r.to, side < 0 ? far - 1.8 : far,
            side < 0 ? far : far + 1.8, .30, grass);
        for (let t = r.from + .55; t < r.to; t += 1.1) {
            const index = Math.round((t - r.from) / 1.1);
            repeated(index % 2 ? 'white_kerbs' : 'black_kerbs', box, index % 2 ? kerbWhite : kerbBlack,
                centre(t) + near, t, .24, [.22, .28, 1.08], Math.atan(r.drift));
        }
        // Two dividers give exactly three 3.5 m lanes in each carriageway.
        for (let lane = 1; lane < r.lanes; lane++) for (let t = r.from + 3; t < r.to - 3; t += 9) {
            if ((t > r.medianBreak[0] - 3 && t < r.medianBreak[1] + 3) || Math.abs(t - r.crossing) < 5) continue;
            strip('lane_divider', t, t + 4, side * (halfMedian + lane * r.laneWidth) - .07,
                side * (halfMedian + lane * r.laneWidth) + .07, .221, white);
        }
        strip('outer_edge_line', r.from, r.to, near - side * .3 - .055,
            near - side * .3 + .055, .221, white);
    }
    // Register the fixed campus apron into the road's frame, so rotating the
    // road cannot rotate or detach the gate connection with it.
    group.updateMatrixWorld(true);
    const apron = (s: number, t: number) => {
        const p = group.worldToLocal(new T.Vector3(.5 * s + .8660254038 * t, 0, -.8660254038 * s + .5 * t));
        return [p.x, p.z];
    };
    polygon('gate_forecourt_paving', [[centre(130) + roadEdge + r.footpathWidth, 130],
        apron(-283.72, 133), apron(-283.72, 169),
        [centre(173) + roadEdge + r.footpathWidth, 173]], .37, paving);
    // The frontage is open at the gate, rather than planting across its approach.
    strip('gate_footpath_connection', 130, 173, roadEdge + r.footpathWidth,
        roadEdge + r.footpathWidth + 1.85, .365, paving);

    for (const [from, to] of [[r.from, r.medianBreak[0]], [r.medianBreak[1], r.to]]) {
        const points = [[centre(from), from], [centre(from + 5) + halfMedian, from + 5],
            [centre(to - 5) + halfMedian, to - 5], [centre(to), to],
            [centre(to - 5) - halfMedian, to - 5], [centre(from + 5) - halfMedian, from + 5]];
        polygon('planted_median', points, .40, grass);
        for (let i = 0; i < points.length; i++) {
            const a = new T.Vector2(...points[i] as [number, number]), b = new T.Vector2(...points[(i + 1) % points.length] as [number, number]);
            const length = a.distanceTo(b), count = Math.ceil(length / 1.1);
            for (let k = 0; k < count; k++) {
                const p = a.clone().lerp(b, (k + .5) / count);
                repeated(k % 2 ? 'white_kerbs' : 'black_kerbs', box, k % 2 ? kerbWhite : kerbBlack,
                    p.x, p.y, .26, [.22, .32, length / count - .025], Math.atan2(b.x - a.x, b.y - a.y));
            }
        }
    }
    // Only the clearly visible crossing on the outer carriageway, beside the
    // end of the long shelter. No inferred arrows or crossing on the gate side.
    for (let i = 0; i < 11; i++) strip('zebra_crossing', r.crossing - 2, r.crossing + 2,
        -roadEdge + .3 + i * .9, -roadEdge + .8 + i * .9, .223, white);

    // Open barrel-vault subway/walkway canopies and closely spaced pale posts.
    const roofShape = new T.Shape();
    const roofHeight = (x: number) => 3.5 + 1.2 * (1 - (x / 3.3) ** 2);
    roofShape.moveTo(-3.3, roofHeight(-3.3));
    for (let i = 1; i <= 16; i++) { const x = -3.3 + i * 6.6 / 16; roofShape.lineTo(x, roofHeight(x)); }
    for (let i = 16; i >= 0; i--) { const x = -3.3 + i * 6.6 / 16; roofShape.lineTo(x, roofHeight(x) - .08); }
    roofShape.closePath();
    for (const [from, to] of r.shelters) {
        strip('shelter_paving', from, to, -2.8, 2.8, .42, paving);
        const roof = new T.ExtrudeGeometry(roofShape, { depth: to - from, steps: 1, bevelEnabled: false });
        const mesh = new T.Mesh(roof, cream); mesh.name = 'SITE_GATE6_curved_shelter_roof';
        mesh.position.set(centre(from), .2, from); mesh.rotation.y = Math.atan(r.drift); group.add(mesh);
        const postBase = .42, postTop = .2 + roofHeight(2.7) - .08;
        for (let t = from + 1; t < to; t += 3) for (const side of [-1, 1]) {
            repeated('shelter_posts', cylinder, cream, centre(t) + side * 2.7, t,
                (postBase + postTop) / 2, [.07, postTop - postBase, .07]);
            repeated('shelter_railing', box, steel, centre(t) + side * 2.72, t, 1.2, [.055, .06, 2.95], Math.atan(r.drift));
        }
        for (let t = from + 1; t < to; t += 2.6) {
            // Shallow seams follow the same low-resolution arch as the roof.
            for (let i = 0; i < 12; i++) {
                const a = -3.3 + i * 6.6 / 12, b = a + 6.6 / 12;
                const start = new T.Vector3(centre(t) + a, .225 + roofHeight(a), t);
                const end = new T.Vector3(centre(t) + b, .225 + roofHeight(b), t);
                const bin = instances.get('roof_ribs') ?? { geometry: cylinder, material: kerbWhite, matrices: [] };
                transform.position.copy(start).add(end).multiplyScalar(.5);
                transform.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), end.clone().sub(start).normalize());
                transform.scale.set(.025, start.distanceTo(end), .025); transform.updateMatrix();
                bin.matrices.push(transform.matrix.clone()); instances.set('roof_ribs', bin);
            }
        }
    }
    for (const t of [-110, -40, 40, 105, 205, 278, 341]) {
        const s = centre(t) + roadEdge + r.footpathWidth + .9;
        repeated('tree_trunks', cylinder, bark, s, t, 2.4, [.21, 4.4, .21]);
        repeated('tree_crowns', crown, foliage, s, t, 5.3, [2.3, 2.8, 2.1]);
        repeated('tree_crowns', crown, foliage, s + .8, t + .6, 4.6, [1.7, 2, 1.8]);
    }
    for (const t of [-105, 0, 107, 246, 340]) {
        const s = centre(t) - roadEdge - 1.5;
        repeated('lamp_poles', cylinder, steel, s, t, 4.7, [.09, 8.9, .09]);
        repeated('lamp_arms', box, steel, s + .7, t, 9.08, [1.5, .10, .10]);
        repeated('lamp_heads', box, steel, s + 1.2, t, 9.02, [.85, .16, .34]);
        repeated('lamp_glass', box, diffuser, s + 1.2, t, 8.925, [.72, .035, .27]);
    }
    // Sign positions and panel colours are visible; destination text is not.
    for (const [offset, t] of [[roadEdge + 1.2, 126], [halfMedian - 1, 114], [-roadEdge - 1, 107]]) {
        const s = centre(t) + offset;
        repeated('sign_posts', cylinder, steel, s, t, 1.7, [.055, 2.85, .055]);
        repeated('blue_sign_panels', box, blue, s, t, 2.95, [.10, 1.15, 1.3]);
        repeated('sign_white_top_border', box, kerbWhite, s + .058, t, 3.48, [.015, .025, 1.18]);
        repeated('sign_white_bottom_border', box, kerbWhite, s + .058, t, 2.42, [.015, .025, 1.18]);
    }
    for (const t of [135, 139]) {
        const s = centre(t) - 1;
        for (const z of [-1.7, 1.7]) repeated('barrier_posts', cylinder, yellow, s, t + z, .8, [.055, 1.1, .055]);
        for (const y of [.4, 1.25]) repeated('yellow_barriers', box, yellow, s, t, y, [.10, .12, 3.7]);
    }
    // Instances stay separate from the lossless mesh merge; only a few draw calls
    // represent hundreds of kerbs, posts and seams. The viewer owns disposal.
    for (const [name, bin] of instances) {
        const mesh = new T.InstancedMesh(bin.geometry, bin.material, bin.matrices.length);
        mesh.name = `SITE_GATE6_${name}`;
        bin.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
    }
}
