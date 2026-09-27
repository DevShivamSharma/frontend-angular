import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as T from 'three';
import { batchVenue } from '../src/app/home/venue-batching';
import { FRONT_GARDEN, FRONT_GARDEN_TREES, isLegacyContextRoad, revealMappedRoads } from '../src/app/home/venue-edge-detail';

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
