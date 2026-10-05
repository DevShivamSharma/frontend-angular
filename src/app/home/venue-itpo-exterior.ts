import * as T from 'three';

// Photo-guided additions to the circled court, on the opposite side of the
// office from the existing east walk. Dimensions are in the model's metres.
export const ITPO_COURT_BEDS = [[-478, -455], [-451, -431], [-427, -409]] as const;
export const ITPO_COURT_PLANTER_T = -395;
export const ITPO_SHELTERS = [[-490, -387], [-440, -401]] as const;
export const GATE9_CHECK_ROOM = { s: -531, t: -377, width: 4.8, depth: 4, angle: .904 } as const;

/** Static, model-aligned geometry. Prepared before batchVenue and owned/disposed
 * by the venue scene, with no animation loop or additional downloaded assets.
 */
export function addItpoExterior(root: T.Group): void {
    const palette = new Map<string, T.MeshStandardMaterial>();
    root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
            if (material instanceof T.MeshStandardMaterial) palette.set(material.name, material);
    });
    const stone = palette.get('PM_Precinct limestone'), coping = palette.get('SITE_ADMIN ivory coping');
    const paving = palette.get('SITE_ADMIN limestone paving'), hedge = palette.get('PM_Plaza planting');
    const foliage = palette.get('SITE_ADMIN foliage 0'), bark = palette.get('SITE_ADMIN tree bark');
    const metal = palette.get('DETAIL luminaire graphite metal');
    if (!stone || !coping || !paving || !hedge || !foliage || !bark || !metal) return;

    const finish = (name: string, color: number, roughness = .8) =>
        new T.MeshStandardMaterial({ name, color, roughness });
    const fabric = finish('SITE_ITPO cream canopy fabric', 0xdad5bb);
    fabric.side = T.DoubleSide;
    const louvre = finish('SITE_ITPO terracotta louvres', 0x783e2d);
    const glass = finish('SITE_ITPO security glazing', 0x354e50, .24);
    glass.metalness = .28; glass.userData['architecturalCategory'] = 'glazing';
    const green = finish('SITE_ITPO bin green', 0x225f3a, .55);
    const yellow = finish('SITE_ITPO yellow kerb paint', 0xbfa142);
    const light = finish('SITE_ITPO streetlight diffuser', 0xe5e3cf, .4);
    const group = new T.Group(); group.name = 'SITE_DETAIL_itpo_exterior';
    group.rotation.y = Math.PI / 3;
    group.userData['photoGuided'] = true;
    const box = new T.BoxGeometry(1, 1, 1);
    const ball = new T.IcosahedronGeometry(1, 1);
    ball.setIndex(Array.from({ length: ball.getAttribute('position').count }, (_, i) => i));
    const cylinder = new T.CylinderGeometry(1, 1, 1, 8);
    const add = (parent: T.Group, geometry: T.BufferGeometry, material: T.Material, name: string,
        s: number, t: number, y: number, scale: [number, number, number]) => {
        const mesh = new T.Mesh(geometry, material); mesh.name = `SITE_ITPO_${name}`;
        mesh.position.set(s, y, t); mesh.scale.set(...scale); parent.add(mesh);
        return mesh;
    };
    const block = (parent: T.Group, material: T.Material, name: string,
        s: number, t: number, y: number, size: [number, number, number]) =>
        add(parent, box, material, name, s, t, y, size);
    const rod = (parent: T.Group, material: T.Material, name: string,
        from: T.Vector3, to: T.Vector3, radius: number) => {
        const mesh = new T.Mesh(cylinder, material); mesh.name = `SITE_ITPO_${name}`;
        mesh.position.copy(from).add(to).multiplyScalar(.5);
        mesh.scale.set(radius, from.distanceTo(to), radius);
        mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        parent.add(mesh);
    };

    function fig(s: number, t: number, index: number) {
        const height = 3.7 + (index % 3) * .35;
        add(group, cylinder, bark!, 'fig_trunk', s, t, 1.8, [.1, 2.8, .1]);
        // Broad, layered leaves reproduce the upright fiddle-leaf silhouettes.
        // Shared low-poly leaves retain the architectural model's foliage style.
        for (let tier = 0; tier < 4; tier++) for (let leaf = 0; leaf < 5; leaf++) {
            const angle = leaf * Math.PI * .4 + tier * .9 + index;
            const reach = tier === 3 ? .35 : .64;
            const mesh = add(group, ball, foliage!, 'fig_leaf', s + Math.cos(angle) * reach,
                t + Math.sin(angle) * reach, height - tier * .54,
                [.43, .65 - tier * .045, .19]);
            mesh.rotation.set(.15, -angle, .2 * Math.sin(angle));
        }
    }
    function lamp(s: number, t: number) {
        add(group, cylinder, metal!, 'street_lamp', s, t, 4.2, [.085, 8.3, .085]);
        for (const side of [-1, 1]) {
            rod(group, metal!, 'lamp_arm', new T.Vector3(s, 8.15, t),
                new T.Vector3(s + side * .95, 8.32, t), .055);
            const head = add(group, ball, metal!, 'lamp_head', s + side * 1.05, t, 8.3, [.62, .12, .24]);
            head.rotation.z = side * -.12;
            block(group, light, 'lamp_glass', s + side * 1.1, t, 8.22, [.65, .035, .25]);
        }
    }
    function bin(s: number, t: number) {
        add(group, cylinder, green, 'bin', s, t, .53, [.3, .96, .3]);
        add(group, cylinder, green, 'bin_lid', s, t, 1.04, [.34, .1, .34]);
        block(group, metal!, 'bin_opening', s, t + .293, .88, [.32, .14, .022]);
    }

    for (const [from, to] of ITPO_COURT_BEDS) {
        const mid = (from + to) / 2, length = to - from, t = ITPO_COURT_PLANTER_T;
        // A 3.2 m planting bed leaves a broad, continuous walk by the façade.
        block(group, stone, 'raised_planter', mid, t, .35, [length, .6, 3.2]);
        block(group, coping, 'planter_coping', mid, t, .69, [length + .12, .08, 3.32]);
        block(group, hedge, 'clipped_hedge', mid, t, .98, [length - .35, .65, 2.85]);
        for (let s = from + 2; s < to - 1; s += 4.8) fig(s, t, Math.round(s - from));
        lamp(mid, t);
        bin(from - 1.5, t + 2.2);
    }

    // Small cream barrel-vault shelters, open at the sides as in the photos.
    // The extruded arch has actual thickness, ribs and posts, not a flat plane.
    const arch = new T.Shape();
    const curveY = (x: number) => 3.3 + 1.15 * (1 - (x / 3.6) ** 2);
    arch.moveTo(-3.6, curveY(-3.6));
    for (let i = 1; i <= 20; i++) { const x = -3.6 + i * .36; arch.lineTo(x, curveY(x)); }
    for (let i = 20; i >= 0; i--) { const x = -3.6 + i * .36; arch.lineTo(x, curveY(x) - .08); }
    arch.closePath();
    const roof = new T.ExtrudeGeometry(arch, { depth: 5.4, bevelEnabled: false, steps: 1 });
    roof.translate(0, 0, -2.7);
    roof.setIndex(Array.from({ length: roof.getAttribute('position').count }, (_, i) => i));
    for (const [s, t] of ITPO_SHELTERS) {
        const shelter = new T.Group(); shelter.name = 'SITE_ITPO_open_canopy';
        shelter.position.set(s, .05, t); group.add(shelter);
        block(shelter, paving, 'canopy_base', 0, 0, .07, [7.8, .14, 6]);
        add(shelter, roof, fabric, 'curved_canopy_roof', 0, 0, 0, [1, 1, 1]);
        for (const x of [-3.25, 3.25]) for (const z of [-2.35, 2.35])
            add(shelter, cylinder, coping, 'canopy_column', x, z, 1.68, [.065, 3.2, .065]);
        for (const z of [-2.6, 0, 2.6]) for (let i = 0; i < 12; i++) {
            const a = -3.5 + i * 7 / 12, b = a + 7 / 12;
            rod(shelter, coping, 'canopy_rib', new T.Vector3(a, curveY(a) - .12, z),
                new T.Vector3(b, curveY(b) - .12, z), .035);
        }
        block(shelter, stone, 'canopy_low_wall', 0, -2.3, .56, [6.5, .95, .24]);
        block(shelter, coping, 'canopy_seat', 0, -1.97, .53, [5.8, .12, .65]);
    }

    // Low cream service enclosure with the red louvred panels of the site photo.
    const service = new T.Group(); service.name = 'SITE_ITPO_service_enclosure';
    service.position.set(-481, .05, -401); group.add(service);
    block(service, stone, 'service_wall', 0, 0, 1.3, [5.4, 2.6, 3.1]);
    block(service, coping, 'service_roof', 0, 0, 2.7, [5.65, .2, 3.35]);
    for (const x of [-1.55, 1.55]) {
        block(service, louvre, 'service_louvre_recess', x, 1.565, 1.32, [1.4, 2.05, .055]);
        for (let y = .4; y < 2.3; y += .13)
            block(service, louvre, 'service_louvre_blade', x, 1.63, y, [1.32, .055, .1]).rotation.x = -.3;
    }
    // Photo's black/yellow kerb at the end of the walk. It borders the planting,
    // leaving the crossing to Gate 9 and the office loop unobstructed.
    for (let i = 0; i < 14; i++)
        block(group, i % 2 ? yellow : metal, 'painted_kerb', -488, -396 + i * .52, .22, [.28, .34, .51]);

    // A modest checkpoint immediately inside Gate 9, beside its passage. Local
    // x follows the gate lintel; local z points inward. The original gate stays.
    const check = new T.Group(); check.name = 'SITE_ITPO_gate9_check_room';
    check.position.set(GATE9_CHECK_ROOM.s, .05, GATE9_CHECK_ROOM.t);
    check.rotation.y = GATE9_CHECK_ROOM.angle;
    check.userData['gate_id'] = 'gate9'; group.add(check);
    const w = GATE9_CHECK_ROOM.width, d = GATE9_CHECK_ROOM.depth;
    block(check, paving, 'checkpoint_plinth', 0, 0, .12, [w + .5, .24, d + .5]);
    block(check, stone, 'checkpoint_wall', 0, 0, 1.62, [w, 3, d]);
    block(check, coping, 'checkpoint_roof', 0, 0, 3.23, [w + .65, .22, d + .65]);
    block(check, louvre, 'checkpoint_fascia', 0, -d / 2 - .34, 3.08, [w + .65, .18, .1]);
    // Dark recessed glazing and pale frames face the entry and the gate lane.
    for (const side of [-1, 1]) {
        block(check, metal, 'checkpoint_window_frame', 0, side * (d / 2 + .025), 1.95, [2.85, 1.38, .06]);
        block(check, glass, 'checkpoint_glass', 0, side * (d / 2 + .065), 1.95, [2.63, 1.16, .035]);
        block(check, coping, 'checkpoint_window_mullion', 0, side * (d / 2 + .095), 1.95, [.06, 1.2, .05]);
        block(check, coping, 'checkpoint_window_sill', 0, side * (d / 2 + .12), 1.25, [3, .1, .25]);
    }
    block(check, metal, 'checkpoint_door_frame', -w / 2 - .025, .5, 1.35, [.06, 2.35, 1.22]);
    block(check, louvre, 'checkpoint_door', -w / 2 - .065, .5, 1.35, [.04, 2.2, 1.08]);
    block(check, glass, 'checkpoint_door_glass', -w / 2 - .09, .5, 1.85, [.035, .9, .83]);
    block(check, coping, 'checkpoint_door_handle', -w / 2 - .14, .88, 1.26, [.06, .3, .045]);
    block(check, paving, 'checkpoint_door_step', -w / 2 - .48, .5, .16, [.85, .18, 1.65]);
    block(check, fabric, 'checkpoint_entry_awning', -w / 2 - .65, .5, 2.75, [1.5, .12, 2.2]);
    root.add(group);
}
