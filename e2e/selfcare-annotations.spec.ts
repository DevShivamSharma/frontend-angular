import { test, expect, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importSelfcareResponse, importSelfcareEventHalls } from '../src/app/planner/geometry/selfcare-layout';
import { planCards } from '../src/app/planner/geometry/plan-annotations';
import { dismissPlottingRules, setupPlanner } from './planner-test-helpers';

const fixture = (name: string) => JSON.parse(readFileSync(resolve('../backend-nest/test/fixtures/selfcare', name), 'utf8'));
const plans = JSON.parse(readFileSync(resolve('../backend-nest/scripts/data/hall-annotations.json'), 'utf8')).halls;

async function renderedAnnotations(page: Page) {
  return page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    const cards: any[] = [], labels: any[] = [];
    c.scene.updateMatrixWorld(true);
    c.camera.updateMatrixWorld(true);
    c.scene.traverse((mesh: any) => {
      if (!['amenity-card', 'exit-label', 'compass-rose', 'compass-label'].includes(mesh.name)) return;
      const canvas = mesh.material.map.image as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 0 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 180) ink++;
      }
      const world = mesh.position.clone().set(0, 0, 0);
      mesh.localToWorld(world);
      const screen = world.project(c.camera);
      const view = c.renderer.domElement.getBoundingClientRect();
      const vertices = mesh.geometry.attributes.position;
      let uncovered = true;
      for (let i = 0; i < vertices.count; i++) {
        const corner = mesh.position.clone().set(vertices.getX(i), vertices.getY(i), vertices.getZ(i));
        mesh.localToWorld(corner).project(c.camera);
        const hit = document.elementFromPoint(view.left + (corner.x + 1) * view.width / 2,
          view.top + (1 - corner.y) * view.height / 2);
        uncovered &&= !!hit?.closest('app-scene3d');
      }
      const item = { name: mesh.name, text: mesh.userData.text,
        kinds: mesh.userData.amenityKinds, ink, visible: mesh.visible,
        inFrame: Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && Math.abs(screen.z) < 1,
        uncovered,
        depthTest: mesh.material.depthTest, order: mesh.renderOrder };
      (mesh.name === 'amenity-card' ? cards : labels).push(item);
    });
    return { cards, labels };
  });
}

test('Hall 14FF: source, seed, API model, grouped textures and top/3D views retain all annotations', async ({ page }, info) => {
  const payload = fixture('hall-14ff.json');
  const source = payload.data[0];
  const imported = importSelfcareResponse(payload)[0];
  const plan = plans['Hall 14FF'];
  const eventHall = importSelfcareEventHalls(fixture('event-halls.json')).find(h => h.id === 62)!;
  expect(eventHall.eventLayoutId).toBeNull();
  expect(imported.amenities).toHaveLength(22); // A null event layout never erases a base plan.
  expect(plan.amenities).toHaveLength(22);
  expect(planCards(plan.amenities)).toHaveLength(13);
  expect(plan.markers).toEqual(imported.markers);
  expect(plan.compass).toEqual(imported.compass);
  expect(plan.legends).toEqual(imported.legends);
  expect(plan.amenities.map((a: any) => [a.kind, a.label, a.anchor, a.slot]))
    .toEqual(imported.amenities!.map(a => [a.kind, a.label, a.anchor, a.slot]));

  const assetResponses = new Map<string, number>();
  const errors: string[] = [];
  page.on('response', r => { if (r.url().includes('/assets/images/')) assetResponses.set(new URL(r.url()).pathname, r.status()); });
  page.on('console', m => { if (m.text().includes('Plan icon missing')) errors.push(m.text()); });
  const hall = { ...imported, ...plan, id: 1088 };
  await setupPlanner(page, [], hall);
  await expect(page.getByRole('list', { name: 'Plan legend', exact: true }).locator('li')).toHaveCount(11);
  await expect.poll(async () => (await renderedAnnotations(page)).cards.length).toBe(13);
  for (const group of source.helper_text) for (const image of group.image) {
    await expect.poll(() => assetResponses.get(`/${image.url}`)).toBe(200);
  }
  await expect.poll(async () => (await renderedAnnotations(page)).labels.find(l => l.name === 'compass-rose')?.ink ?? 0).toBeGreaterThan(100);
  const state = await renderedAnnotations(page);
  expect(state.cards.flatMap(c => c.kinds)).toHaveLength(22);
  expect(state.labels.filter(l => l.name === 'exit-label').map(l => l.text)).toEqual(source.exit_labels.map((l: any) => l.text));
  expect(state.cards.every(c => c.ink > 100 && c.depthTest === false && c.order === 25)).toBe(true);
  expect(state.cards.every(c => c.uncovered)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('hall-14ff-after-3d.png'), fullPage: true });
  await page.evaluate(() => {
    const c = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    c.applyView({ kind: 'top', seq: 100 }, s.currentHall());
  });
  expect((await renderedAnnotations(page)).cards.every(c => c.inFrame)).toBe(true);
  expect((await renderedAnnotations(page)).cards.every(c => c.uncovered)).toBe(true);
  expect((await renderedAnnotations(page)).labels.every(l => l.inFrame && l.ink > 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('hall-14ff-after-top.png'), fullPage: true });

  // Reproduce the old imported data, using the captured seed rather than invented icons.
  const legacy = fixture('hall-14ff-legacy-amenities.json');
  await page.evaluate(amenities => {
    const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
    s.halls.update((halls: any[]) => halls.map(h => ({ ...h, amenities, compass: null, legends: null })));
  }, legacy);
  await expect.poll(async () => (await renderedAnnotations(page)).cards.flatMap(c => c.kinds).length).toBe(12);
  await page.screenshot({ path: info.outputPath('hall-14ff-before-top.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.screenshot({ path: info.outputPath('hall-14ff-before-3d.png'), fullPage: true });
});

test('Hall 8-9-10: repeated toilet/stair groups and entry survive the shared pipeline', async ({ page }, info) => {
  const imported = importSelfcareResponse(fixture('hall-8-9-10.json'))[0];
  const plan = plans['Hall 8-9-10'];
  expect(plan.amenities).toHaveLength(8);
  expect(planCards(plan.amenities)).toHaveLength(4);
  await setupPlanner(page, [], { ...imported, ...plan });
  await expect.poll(async () => (await renderedAnnotations(page)).cards.flatMap(c => c.kinds).length).toBe(8);
  await expect.poll(async () => (await renderedAnnotations(page)).labels.find(l => l.name === 'compass-rose')?.ink ?? 0).toBeGreaterThan(100);
  expect((await renderedAnnotations(page)).labels.filter(l => l.name === 'exit-label')).toHaveLength(10);
  await page.screenshot({ path: info.outputPath('hall-8-9-10-after-3d.png'), fullPage: true });
});

test('live API: repaired standalone halls render from persistence', async ({ page, request }, info) => {
  const response = await request.get('http://localhost:8080/api/halls?standalone=true').catch(() => null);
  test.skip(!response?.ok(), 'Local Nest API is unavailable; fixture checks still run.');
  const halls = await response!.json();
  await page.goto('/planner/editor');
  await dismissPlottingRules(page);
  await page.waitForFunction(() => (window as any).ng?.getComponent(document.querySelector('app-planner-page'))?.store.hallsStatus() === 'ready');
  for (const [name, icons, labels] of [['Hall 14FF', 22, 16], ['Hall 14GF', 27, 17], ['Hall 8-9-10', 8, 10]] as const) {
    const hall = halls.find((h: any) => h.name === name);
    expect(hall.amenities).toHaveLength(icons);
    expect(hall.markers).toHaveLength(labels);
    await page.evaluate(id => {
      (window as any).ng.getComponent(document.querySelector('app-planner-page')).store.activeHallId.set(id);
    }, hall.id);
    await expect.poll(async () => (await renderedAnnotations(page)).cards.flatMap(c => c.kinds).length).toBe(icons);
    await expect.poll(async () => (await renderedAnnotations(page)).labels.find(l => l.name === 'compass-rose')?.ink ?? 0).toBeGreaterThan(100);
    expect((await renderedAnnotations(page)).labels.filter(l => l.name === 'exit-label')).toHaveLength(labels);
    await page.getByRole('button', { name: 'Fit hall in view', exact: true }).click();
    expect((await renderedAnnotations(page)).cards.every(c => c.uncovered)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name.replaceAll(' ', '-')}-live-3d.png`), fullPage: true });
    await page.getByRole('button', { name: 'Top-down view', exact: true }).click();
    expect((await renderedAnnotations(page)).cards.every(c => c.uncovered)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name.replaceAll(' ', '-')}-live-top.png`), fullPage: true });
    await info.attach(`${name}-rendered`, { body: JSON.stringify(await renderedAnnotations(page), null, 2), contentType: 'application/json' });
  }
  const snapshotPath = resolve('../backend-nest/test-results/selfcare/before-db.json');
  if (existsSync(snapshotPath)) {
    const prior = JSON.parse(readFileSync(snapshotPath, 'utf8')).find((h: any) => Number(h.id) === 1088);
    if (prior) {
      const before = { ...prior, id: Number(prior.id), blockedAreas: prior.blocked_areas };
      await page.evaluate(hall => {
        const s = (window as any).ng.getComponent(document.querySelector('app-planner-page')).store;
        s.halls.update((halls: any[]) => halls.map(h => h.id === hall.id ? hall : h));
        s.activeHallId.set(hall.id);
      }, before);
      await expect.poll(async () => (await renderedAnnotations(page)).cards.flatMap(c => c.kinds).length).toBe(12);
      await page.getByRole('button', { name: 'Fit hall in view', exact: true }).click();
      await page.screenshot({ path: info.outputPath('Hall-14FF-stored-before-3d.png'), fullPage: true });
      await page.getByRole('button', { name: 'Top-down view', exact: true }).click();
      await page.screenshot({ path: info.outputPath('Hall-14FF-stored-before-top.png'), fullPage: true });
    }
  }
});

test('live API: every sourced hall retains its complete annotations', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const response = await request.get('http://localhost:8080/api/halls?standalone=true').catch(() => null);
  test.skip(!response?.ok(), 'Local Nest API unavailable; no all-hall rendering claim.');
  const halls = await response!.json();
  const assets = new Map<string, number>();
  page.on('response', r => {
    if (r.url().includes('/assets/images/')) assets.set(new URL(r.url()).pathname, r.status());
  });
  await page.goto('/planner/editor');
  await dismissPlottingRules(page);
  await page.waitForFunction(() => (window as any).ng?.getComponent(document.querySelector('app-planner-page'))?.store.hallsStatus() === 'ready');
  const report: unknown[] = [];
  for (const [name, raw] of Object.entries(plans)) {
    const plan = raw as any;
    if (!plan.amenities.length) continue;
    await test.step(name, async () => {
      const hall = halls.find((h: any) => h.name === name);
      expect(hall, name).toBeTruthy();
      for (const key of ['amenities', 'markers', 'compass', 'legends']) expect(hall[key], `${name}: ${key}`).toEqual(plan[key]);
      await page.evaluate(id => {
        (window as any).ng.getComponent(document.querySelector('app-planner-page')).store.activeHallId.set(id);
      }, hall.id);
      await expect.poll(async () => (await renderedAnnotations(page)).cards.flatMap(c => c.kinds).length).toBe(plan.amenities.length);
      for (const kind of new Set<string>(plan.amenities.map((a: any) => a.kind))) {
        await expect.poll(() => assets.get(`/assets/images/${kind}.svg`)).toBe(200);
      }
      await expect.poll(async () => (await renderedAnnotations(page)).labels.find(l => l.name === 'compass-rose')?.ink ?? 0).toBeGreaterThan(100);
      await page.getByRole('button', { name: 'Fit hall in view', exact: true }).click();
      const perspective = await renderedAnnotations(page);
      expect(perspective.cards.every(c => c.uncovered && c.inFrame && c.ink > 100), `${name}: 3D cards`).toBe(true);
      expect(perspective.labels.filter(l => l.name === 'exit-label').map(l => l.text)).toEqual(plan.markers.map((m: any) => m.text));
      await page.getByRole('button', { name: 'Top-down view', exact: true }).click();
      const top = await renderedAnnotations(page);
      expect(top.cards.every(c => c.uncovered && c.inFrame && c.ink > 100), `${name}: top cards`).toBe(true);
      report.push({ name, icons: plan.amenities.length, groups: top.cards.length, labels: plan.markers.length,
        compass: true, legends: plan.legends.length, perspective, top });
      if (['Hall 6', 'Hall 1GF', 'Hall 11'].includes(name)) {
        await page.screenshot({ path: info.outputPath(`${name.replaceAll(' ', '-')}-verified.png`), fullPage: true });
      }
    });
  }
  expect(report).toHaveLength(21);
  await info.attach('all-hall-rendering', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
