import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as T from 'three';
import { batchVenue } from '../src/app/home/venue-batching';
import { addGate6Road, FRONT_GARDEN, FRONT_GARDEN_TREES, isLegacyContextRoad, revealMappedRoads } from '../src/app/home/venue-edge-detail';

const clip = require('polygon-clipping');
const { campusFootprint } = require('../scripts/model-footprint.cjs');
const { polygon } = require('../scripts/restore-nearby-map.cjs');

test('front garden fits the actual open recess without covering mapped roads, buildings or campus', () => {
    const { minS, maxS, minT, maxT } = FRONT_GARDEN;
    const W = (s: number, t: number) => [.5 * s + .8660254038 * t, -.8660254038 * s + .5 * t];
    const garden = [[W(minS, minT), W(maxS, minT), W(maxS, maxT), W(minS, maxT), W(minS, minT)]];
    const footprint = campusFootprint(readFileSync('outputs/outputs/IITF_2026_ARCHITECTURAL.glb'));
    expect(clip.intersection(footprint, garden)).toEqual([]);
    const context = JSON.parse(readFileSync('src/assets/venue/geography/delhi-context.json', 'utf8'));
    const overlaps = context.features.filter((feature: any) => clip.intersection(polygon(feature), garden).length)
        .map((feature: any) => ({ kind: feature.k, id: feature.osmWay }));
    expect(overlaps).toEqual([]);
    for (const [s, t] of FRONT_GARDEN_TREES) {
        expect(FRONT_GARDEN_TREES.some(([otherS, otherT]) => otherS === minS + maxS - s && otherT === t)).toBe(true);
        expect(FRONT_GARDEN_TREES.some(([otherS, otherT]) => otherS === s && otherT === minT + maxT - t)).toBe(true);
        expect(s - 3).toBeGreaterThan(minS); expect(s + 3).toBeLessThan(maxS);
        expect(t - 3).toBeGreaterThan(minT); expect(t + 3).toBeLessThan(maxT);
    }
});

test('map-ready replacement preserves campus drives and fallback roads through batching', () => {
    const root = new T.Group(), geometry = new T.BoxGeometry(), material = new T.MeshStandardMaterial();
    for (const name of ['PHOTO_ROADS_asphalt_network', 'PHOTO_ROADS_lane_markings', 'PHOTO_ROADS perimeter kerbs',
        'PHOTO_PATH_Eastern_perimeter_service_drive', 'PHOTO_PATH_Gate_3_to_hall_promenade', 'PHOTO_CC_lower_parking']) {
        const mesh = new T.Mesh(geometry, material); mesh.name = name; root.add(mesh);
    }
    // With the map pending or failed, the original exterior remains visible.
    expect(root.children.every(object => object.visible)).toBe(true);
    batchVenue(root, () => null, object => String(isLegacyContextRoad(object)));
    expect(root.children).toHaveLength(2);
    expect(root.children.every(object => object.visible)).toBe(true);
    revealMappedRoads(root);
    expect(root.children.find(isLegacyContextRoad)?.visible).toBe(false);
    expect(root.children.find(object => !isLegacyContextRoad(object))?.visible).toBe(true);
});

test('Gate 6 road provides six lanes outside the gate with an unobstructed median opening', () => {
    const root = new T.Group(); addGate6Road(root); addGate6Road(root);
    expect(root.children).toHaveLength(1);
    root.updateMatrixWorld(true);
    const W = (s: number, t: number, y: number) => new T.Vector3(.5 * s + .8660254038 * t, y, -.8660254038 * s + .5 * t);
    const probe = (s: number, t: number) => new T.Raycaster(W(s, t, 20), new T.Vector3(0, -1, 0)).intersectObject(root, true);
    // A sample in the centre of every lane must meet asphalt, never a slab,
    // canopy, tree or kerb. This also guards campus/world axis registration.
    for (const t of [100, 151, 240, 320]) for (const side of [-1, 1]) for (let lane = 0; lane < 3; lane++) {
        const s = -306.4 - .0144 * (t - 151) + side * (3 + (lane + .5) * 3.5);
        expect(probe(s, t)[0]?.object.name).toBe('SITE_GATE6_asphalt');
    }
    expect(probe(-306.4, 151)[0]?.object.name).toBe('SITE_GATE6_asphalt');
    expect(probe(-288, 151)[0]?.object.name).toBe('SITE_GATE6_gate_forecourt_paving');
    const road = root.getObjectByName('SITE_GATE6_asphalt') as T.Mesh;
    expect(road.position.y).toBeGreaterThan(.19); // authored promenade/inlay height
    expect(road.position.y).toBeLessThan(.36); // footpath remains raised
    // Posts must physically meet the tessellated roof, including its road drift.
    const posts = root.getObjectByName('SITE_GATE6_shelter_posts') as T.InstancedMesh;
    const roofs = root.children[0].children.filter(o => o.name === 'SITE_GATE6_curved_shelter_roof');
    const matrix = new T.Matrix4(), scale = new T.Vector3(), position = new T.Vector3(), rotation = new T.Quaternion();
    for (let i = 0; i < posts.count; i++) {
        posts.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
        const top = posts.localToWorld(position.clone().add(new T.Vector3(0, scale.y / 2, 0)));
        const hits = new T.Raycaster(new T.Vector3(top.x, 20, top.z), new T.Vector3(0, -1, 0)).intersectObjects(roofs);
        expect(hits.length).toBeGreaterThan(0);
        expect(Math.abs(hits[hits.length - 1].point.y - top.y)).toBeLessThan(.02);
    }
    const instanced = root.children[0].children.filter(o => o instanceof T.InstancedMesh) as T.InstancedMesh[];
    expect(instanced.reduce((n, mesh) => n + mesh.count, 0)).toBeGreaterThan(500);
    batchVenue(root, () => null, mesh => String(isLegacyContextRoad(mesh)));
    revealMappedRoads(root);
    let draws = 0, triangles = 0;
    root.traverse(o => {
        if (!(o instanceof T.Mesh)) return;
        expect(o.visible).toBe(true);
        draws++;
        triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3 *
            (o instanceof T.InstancedMesh ? o.count : 1);
    });
    expect(draws).toBeLessThan(35);
    expect(triangles).toBeLessThan(50000);
});
