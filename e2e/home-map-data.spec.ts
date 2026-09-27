import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const clip = require('polygon-clipping');
const { campusFootprint, polygon } = require('../scripts/restore-nearby-map.cjs');
const context = JSON.parse(readFileSync('src/assets/venue/geography/delhi-context.json', 'utf8'));
type Point = [number, number];
const area = (polygons: Point[][][]) => polygons.reduce((sum, rings) => sum + rings.reduce((value, p, index) =>
  value + (index ? -1 : 1) * Math.abs(p.slice(1).reduce((a, b, i) => a + p[i][0] * b[1] - b[0] * p[i][1], 0)) / 2, 0), 0);

test('home map: nearby data reaches all three marked sides of the campus', () => {
  // The old radius-based omission left these strips without local context.
  const strips = {
    north: [[-650, -900], [500, -900], [500, -500], [-650, -500], [-650, -900]],
    east: [[520, -450], [1000, -450], [1000, 450], [520, 450], [520, -450]],
    south: [[-600, 430], [500, 430], [500, 900], [-600, 900], [-600, 430]]
  };
  for (const [side, ring] of Object.entries(strips)) {
    let coverage = 0;
    for (const feature of context.features.filter((f: any) => f.osmWay)) {
      coverage += area(clip.intersection(polygon(feature), [ring]));
    }
    expect(coverage, `Real map coverage on the ${side} side (square metres)`).toBeGreaterThan(5000);
  }
});

test('home map: restored geography excludes the actual irregular campus footprint', () => {
  const footprint = campusFootprint(readFileSync('outputs/outputs/IITF_2026_ARCHITECTURAL.glb'));
  expect(context.nearby.footprint).toEqual(footprint);
  let overlap = 0, nearbyFeatures = 0;
  for (const feature of context.features.filter((f: any) => f.osmWay)) {
    nearbyFeatures++;
    overlap += area(clip.intersection(polygon(feature), footprint));
  }
  expect(nearbyFeatures).toBeGreaterThan(500);
  expect(overlap, 'Restored map must not cover the authored campus').toBeLessThan(.01);
});
