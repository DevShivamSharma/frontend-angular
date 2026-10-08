import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { preparePdfHall } from '../src/app/planner/pdf-workspace/pdf-hall-plan';
import { dismissPlottingRules } from './planner-test-helpers';
import {
  area,
  calibrate,
  calibrationFor,
  polygonError,
  sourceToMetres,
  PdfWorkspace,
  PdfObject,
} from '../src/app/planner/pdf-workspace/pdf-workspace.model';
import {
  workspaceBackup,
  readWorkspaceBackup,
} from '../src/app/planner/pdf-workspace/pdf-workspace.backup';

/** Small original fixture: real text, a diagonal polygon, curve, clip, transform and rotated page. */
function fixture(): Buffer {
  const contents =
    'q 1 0 0 1 10 20 cm 1 0 0 RG 2 w 40 40 m 240 40 l 280 100 l 280 220 l 40 220 l h S Q\n0 0 1 RG 60 280 m 100 340 200 340 240 280 c S\nq 20 20 10 10 re W n 0 0 200 200 re S Q\nBT /F1 14 Tf 40 360 Td (Hall A - 1 m grid) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Rotate 90 /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => (pdf += `${String(offset).padStart(10, '0')} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
async function point(page: Page, x: number, y: number): Promise<void> {
  const three = page.locator('app-scene3d canvas');
  if (await page.locator('app-pdf-three-scene').count()) {
    await expect(three).toBeVisible();
    await page.waitForFunction(
      () =>
        (window as any).ng.getComponent(document.querySelector('app-pdf-three-scene'))?.sourceReady,
    );
    const client = await page.evaluate(
      ({ x, y }) => {
        const component = (window as any).ng.getComponent(
          document.querySelector('app-pdf-three-scene'),
        );
        const p = component.scene.position
          .clone()
          .set(x - component.page().width / 2, 0, y - component.page().height / 2);
        component.camera.updateMatrixWorld();
        p.project(component.camera);
        const b = component.renderer.domElement.getBoundingClientRect();
        return { x: b.left + ((p.x + 1) * b.width) / 2, y: b.top + ((1 - p.y) * b.height) / 2 };
      },
      { x, y },
    );
    await page.mouse.click(client.x, client.y);
    return;
  }
  const svg = page.locator('svg[aria-label="Selectable PDF overlays"]');
  const box = await svg.boundingBox();
  if (!box) throw new Error('PDF overlay missing');
  const view = await svg.getAttribute('viewBox');
  const [, , w, h] = view!.split(' ').map(Number);
  await page.mouse.click(box.x + (x / w) * box.width, box.y + (y / h) * box.height);
}
async function upload(page: Page, buffer = fixture(), name = 'geometry.pdf'): Promise<void> {
  await page.goto('/planner/pdf');
  await page
    .getByLabel('Open PDF', { exact: true })
    .setInputFiles({ name, mimeType: 'application/pdf', buffer });
  await expect(page.locator('.drawing-footer')).toBeVisible({ timeout: 90_000 });
  await expect(
    page.locator('.document-bar').getByText('Saved on this browser', { exact: true }),
  ).toBeVisible();
}
test('calibration preserves fractional geometry and rejects invalid input', () => {
  const scale = calibrate({ x: 5, y: 10 }, { x: 205, y: 10 }, 42.5);
  expect(scale.metresPerUnit).toBe(0.2125);
  expect(sourceToMetres([{ x: 7.3, y: 14.1 }], scale)[0].x).toBeCloseTo(0.48875, 10);
  expect(() => calibrate({ x: 0, y: 0 }, { x: 0, y: 0 }, 10)).toThrow();
  expect(() => calibrate({ x: 0, y: 0 }, { x: 10, y: 0 }, NaN)).toThrow();
  expect(
    polygonError([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]),
  ).toBeNull();
  expect(
    polygonError([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]),
  ).not.toBeNull();
});
test('hall calibration overrides page calibration without coupling other halls', () => {
  const pageScale = calibrate({ x: 0, y: 0 }, { x: 100, y: 0 }, 10),
    hallScale = calibrate({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
  const hall = { id: 'hall', kind: 'hall', page: 1, calibration: hallScale } as PdfObject;
  const doc = { objects: [hall], pageCalibrations: { 1: pageScale } } as PdfWorkspace;
  expect(calibrationFor(doc, { page: 1, regionId: 'hall' } as PdfObject)).toEqual(hallScale);
  expect(calibrationFor(doc, { page: 1 } as PdfObject)).toEqual(pageScale);
  expect(calibrationFor(doc, { page: 2, regionId: 'hall' } as PdfObject)).toBeUndefined();
});
test('portable backups preserve exact PDF bytes and reject tampered content', async () => {
  const pdf = Uint8Array.from(fixture()).buffer;
  const points = [
    { x: 1.125, y: 2 },
    { x: 11, y: 2 },
    { x: 15, y: 9 },
    { x: 1.125, y: 10 },
  ];
  const calibration = calibrate({ x: 0, y: 0 }, { x: 200, y: 0 }, 42.5);
  const doc: PdfWorkspace = {
    version: 1,
    id: 'test',
    name: 'fixture.pdf',
    sha256: createHash('sha256').update(fixture()).digest('hex'),
    pdf,
    page: 1,
    objects: [
      {
        id: 'hall',
        name: 'Hall 8',
        page: 1,
        kind: 'hall',
        sourcePoints: points,
        points,
        reviewed: true,
        heightMetres: null,
        calibration,
      },
    ],
    pageCalibrations: {},
    updatedAt: 1,
  };
  const bytes = await workspaceBackup(doc).arrayBuffer(),
    restored = await readWorkspaceBackup(bytes);
  expect(Buffer.from(restored.pdf)).toEqual(fixture());
  expect(restored.objects).toEqual(doc.objects);
  expect(restored.id).not.toBe(doc.id);
  const corrupt = bytes.slice(0);
  new Uint8Array(corrupt)[corrupt.byteLength - 1] ^= 1;
  await expect(readWorkspaceBackup(corrupt)).rejects.toThrow('integrity');
  const invalid = { ...doc, objects: [{ ...doc.objects[0], regionId: 'missing' }] };
  await expect(readWorkspaceBackup(await workspaceBackup(invalid).arrayBuffer())).rejects.toThrow(
    'hall association',
  );
});
test('PDF stays local; diagonal geometry, calibrated edits, undo and original survive reload', async ({
  page,
}) => {
  const errors: string[] = [],
    uploads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() !== 'GET') uploads.push(request.url());
  });
  await upload(page);
  await expect(page.getByText(/1 curved paths/)).toHaveCount(1);
  await page.getByRole('button', { name: 'Calibrate scale', exact: true }).click();
  await point(page, 50, 340);
  await point(page, 250, 340);
  await page.getByLabel('Known distance (m)', { exact: true }).fill('42.5');
  await page.getByRole('button', { name: 'Apply to this page', exact: true }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await point(page, 150, 250);
  await expect(page.getByRole('button', { name: 'Create editable outline' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create editable outline' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Diagonal hall');
  await page.getByLabel('Name', { exact: true }).blur();
  await page.getByRole('combobox', { name: 'Object type', exact: true }).selectOption('hall');
  await page.getByText('Move or edit vertices', { exact: true }).click();
  const original = await page.getByLabel('Vertices: x, y in page coordinates').inputValue();
  expect(original.split('\n')).toHaveLength(5);
  expect(original.split('\n').map((line) => line.split(',').map(Number))).toEqual([
    [50, 340],
    [250, 340],
    [290, 280],
    [290, 160],
    [50, 160],
  ]);
  await page.getByLabel('Move X (m)', { exact: true }).fill('0.123');
  await page.getByRole('button', { name: 'Move object', exact: true }).click();
  expect(await page.getByLabel('Vertices: x, y in page coordinates').inputValue()).not.toBe(
    original,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Diagonal hall hall', exact: false }).click();
  expect(await page.getByLabel('Vertices: x, y in page coordinates').inputValue()).toBe(original);
  await page.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(
    page.locator('.document-bar').getByText('Saved on this browser', { exact: true }),
  ).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.locator('.drawing-footer')).toBeVisible();
  expect(page.url()).toBe(url);
  await page.getByRole('button', { name: 'Diagonal hall hall', exact: false }).click();
  await page.getByText('Move or edit vertices', { exact: true }).click();
  expect(await page.getByLabel('Vertices: x, y in page coordinates').inputValue()).toBe(original);
  await expect(page.getByLabel('Confirmed height (m)')).toHaveValue('');
  await expect(page.getByLabel('Selected object 3D preview')).toHaveCount(0);
  await page.getByLabel('Confirmed height (m)').fill('2.7');
  await page.getByLabel('Confirmed height (m)').blur();
  await expect(page.getByLabel('Selected object 3D preview').locator('canvas')).toBeVisible();
  await page.getByLabel('Confirmed height (m)').fill('');
  await page.getByLabel('Confirmed height (m)').blur();
  await page.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(
    page.locator('.document-bar').getByText('Saved on this browser', { exact: true }),
  ).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original', exact: true }).click();
  const file = await (await downloaded).path();
  expect(createHash('sha256').update(readFileSync(file!)).digest('hex')).toBe(
    createHash('sha256').update(fixture()).digest('hex'),
  );
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});
test('manual trace, per-page scale, rotated pages, review report and mobile layout', async ({
  page,
}) => {
  await upload(page);
  await page.getByRole('button', { name: 'Trace outline', exact: true }).click();
  for (const [x, y] of [
    [50, 100],
    [150, 100],
    [190, 160],
    [50, 180],
  ])
    await point(page, x, y);
  await page.getByRole('button', { name: 'Finish outline', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Object type', exact: true })).toHaveValue(
    'unknown',
  );
  await expect(page.getByLabel('Confirmed height (m)')).toHaveValue('');
  await page.getByLabel('Page number', { exact: true }).fill('2');
  await page.getByLabel('Page number', { exact: true }).blur();
  await expect(page.getByRole('heading', { name: /Objects on page 2/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Measure', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await point(page, 200, 150);
  await expect(page.getByRole('button', { name: 'Create editable outline' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create editable outline' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report' }).click();
  const report = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(report.objects).toHaveLength(2);
  expect(report.currentPage.rotation).toBe(90);
  expect(report.objects[1].sourcePoints).toEqual([
    { x: 60, y: 50 },
    { x: 60, y: 250 },
    { x: 120, y: 290 },
    { x: 240, y: 290 },
    { x: 240, y: 50 },
  ]);
  expect(report.objects.every((o: any) => o.heightMetres === null && o.metres === null)).toBe(true);
  expect(report.currentPage.issues.some((i: string) => i.includes('clipping'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const note = document
          .querySelector('app-pdf-three-scene .scene-note')!
          .getBoundingClientRect();
        const footer = document.querySelector('.drawing-footer')!.getBoundingClientRect();
        const sidebar = document.querySelector('.workspace > aside')!.getBoundingClientRect();
        return note.bottom <= footer.top + 1 && footer.bottom <= sidebar.top + 1;
      }),
    )
    .toBe(true);
  await page.screenshot({ path: 'test-results/pdf-workspace-mobile.png', fullPage: true });
});
test('invalid files fail clearly without creating a document', async ({ page }) => {
  await page.goto('/planner/pdf');
  await page.getByLabel('Open PDF', { exact: true }).setInputFiles({
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(page.getByRole('alert')).toContainText('not a PDF');
  await expect(page.locator('.drawing-footer')).toHaveCount(0);
});

test('Three.js shows the full import and supports orbit, calibration, tracing and confirmed heights', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await upload(page);
  const three = page.locator('app-pdf-three-scene');
  await expect(page.locator('app-scene3d canvas')).toBeVisible();
  await expect(three.getByRole('status')).toContainText('Full-page overview');
  await page.getByRole('button', { name: '3D orbit', exact: true }).click();
  await page.getByRole('button', { name: 'Trace outline', exact: true }).click();
  for (const [x, y] of [
    [80, 80],
    [220, 80],
    [240, 200],
    [80, 200],
  ])
    await point(page, x, y);
  await page.getByRole('button', { name: 'Finish outline', exact: true }).click();
  // Ray/plane intersection in the tilted camera must preserve the polygon's source coordinates.
  let doc = await page.evaluate(() =>
    (window as any).ng.getComponent(document.querySelector('app-pdf-workspace')).doc(),
  );
  expect(doc.objects[0].points).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    // Browser pointer events carry finite screen precision: require <0.0001 page-unit error.
    expect(Math.abs(doc.objects[0].points[i].x - [80, 220, 240, 80][i])).toBeLessThan(0.0001);
    expect(Math.abs(doc.objects[0].points[i].y - [80, 80, 200, 200][i])).toBeLessThan(0.0001);
  }
  await page.getByLabel('Confirmed height (m)').fill('2.5');
  await page.getByLabel('Confirmed height (m)').blur();
  const extrusions = () =>
    page.evaluate(
      () =>
        (window as any).ng
          .getComponent(document.querySelector('app-pdf-three-scene'))
          .objectGroup.children.filter((m: any) => m.name === 'confirmed-height-object').length,
    );
  expect(await extrusions()).toBe(0);
  await page.getByRole('button', { name: 'Calibrate scale', exact: true }).click();
  await page.getByText('Enter precise reference points', { exact: true }).click();
  await page.getByLabel('Reference coordinates: x, y per line').fill('0,0\n100,0');
  await page.getByRole('button', { name: 'Use reference coordinates', exact: true }).click();
  await page.getByLabel('Known distance (m)', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Apply to this page', exact: true }).click();
  await expect.poll(extrusions).toBe(1);
  const depth = await page.evaluate(
    () =>
      (window as any).ng
        .getComponent(document.querySelector('app-pdf-three-scene'))
        .objectGroup.getObjectByName('confirmed-height-object').geometry.parameters.options.depth,
  );
  expect(depth).toBe(25);
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await point(page, 80, 80);
  await point(page, 220, 80);
  await expect(page.locator('.measurement')).toContainText('14.000');
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).ng
          .getComponent(document.querySelector('app-pdf-three-scene'))
          .sourceGroup.children.some((m: any) => m.name === 'pdf-zoom-detail'),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '2D reference', exact: true }).click();
  await expect(page.getByLabel('Selectable PDF overlays')).toBeVisible();
  await page.getByRole('button', { name: 'Three.js workspace', exact: true }).click();
  await expect(three.getByRole('status')).toContainText('Full-page overview');
  expect(await extrusions()).toBe(1);
  await page.getByLabel('Page number', { exact: true }).fill('2');
  await page.getByLabel('Page number', { exact: true }).blur();
  await expect(page.getByRole('heading', { name: /Objects on page 2/ })).toBeVisible();
  await expect(three.getByRole('status')).toContainText('Full-page overview');
  expect(await extrusions()).toBe(0);
  expect(errors).toEqual([]);
});
test('actual hall PDF: source rendering and extraction inventory', async ({ page }, testInfo) => {
  const path = process.env['PDF_REFERENCE_FILE'];
  test.skip(
    !path,
    'Set PDF_REFERENCE_FILE to a local CAD PDF; customer drawings are not committed.',
  );
  test.setTimeout(180_000);
  const original = readFileSync(path!);
  await upload(page, original, '8-9-10.pdf');
  await expect(page.getByLabel('Page number', { exact: true })).toHaveValue('1');
  await page.getByText(/Extracted text \(/).click();
  await expect(page.locator('.text-list')).toContainText('Grid size is 1m x 1m');
  await expect(page.locator('.text-list')).toContainText('HALL 8');
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/pdf-workspace-actual.png', fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report' }).click();
  const report = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(report.currentPage.curvedPaths).toBeGreaterThan(0);
  expect(report.document.sha256).toBe(createHash('sha256').update(original).digest('hex'));
  expect(report.currentPage.texts.some((t: any) => t.text.includes('HALL 9'))).toBe(true);
  expect(report.objects).toHaveLength(0);
  expect(report.currentPage.pathCount).toBe(75188);
  await testInfo.attach('actual-pdf-inspection.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  // Manually reviewed source-coordinate samples, confined to this test, never production rules.
  // Adjacent 1 m grid lines in Hall 9 provide calibration; this is not a physical site survey.
  await page.getByRole('button', { name: 'Calibrate scale', exact: true }).click();
  await page.getByText('Enter precise reference points', { exact: true }).click();
  await page
    .getByLabel('Reference coordinates: x, y per line')
    .fill('1335.3299560546875, 1200\n1344.1500244140625, 1200');
  await page.getByRole('button', { name: 'Use reference coordinates', exact: true }).click();
  await page.getByLabel('Known distance (m)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply to this page', exact: true }).click();
  for (const sample of [
    {
      name: 'Hall 9 grid region (review sample)',
      points:
        '1327.530029296875, 1090.780029296875\n1623.1199951171875, 1090.780029296875\n1623.1199951171875, 1329.1300048828125\n1327.530029296875, 1329.1300048828125',
    },
    {
      name: 'Hall 8 diagonal grid region (review sample)',
      points:
        '1754.25, 1193.3499755859375\n1806.3299560546875, 1193.3499755859375\n1846.0499267578125, 1233.070068359375\n1846.0499267578125, 1330.179931640625\n1754.25, 1330.179931640625',
    },
  ]) {
    await page.getByRole('button', { name: 'Trace outline', exact: true }).click();
    await page.getByText('Enter outline coordinates', { exact: true }).click();
    await page.getByLabel('Outline coordinates: x, y per line').fill(sample.points);
    await page
      .getByRole('button', { name: 'Create outline from coordinates', exact: true })
      .click();
    await page.getByLabel('Name', { exact: true }).fill(sample.name);
    await page.getByLabel('Name', { exact: true }).blur();
    await page.getByRole('combobox', { name: 'Object type', exact: true }).selectOption('hall');
  }
  await page.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(
    page.locator('.document-bar').getByText('Saved on this browser', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.drawing-footer')).toBeVisible();
  const reviewed = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report' }).click();
  const after = JSON.parse(readFileSync((await (await reviewed).path())!, 'utf8'));
  expect(after.objects).toHaveLength(2);
  expect(after.objects[1].points).toHaveLength(5);
  expect(after.objects[1].points).toEqual(after.objects[1].sourcePoints);
  expect(after.pageCalibrations['1'].metresPerUnit).toBeCloseTo(1 / 8.820068359375, 12);
  expect(
    after.objects.every((o: any) => o.metres?.length && o.heightMetres === null && !o.reviewed),
  ).toBe(true);
  await testInfo.attach('actual-pdf-calibrated-review.json', {
    body: JSON.stringify(after, null, 2),
    contentType: 'application/json',
  });
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backupPath = await (await backup).path();
  await page.getByLabel('Open backup', { exact: true }).setInputFiles(backupPath!);
  await expect(page.locator('.drawing-footer')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Objects on page 1 \(2\)/ })).toBeVisible();
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.evaluate(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed'));
  await page.getByRole('button', { name: /Hall 9 grid region \(review sample\) hall/ }).click();
  await page.getByLabel('I reviewed this outline and its meaning').check();
  await page.getByRole('button', { name: 'Preview in main planner', exact: true }).click();
  await expect(page).toHaveURL(/planner\/editor\?pdfDocument=/);
  await dismissPlottingRules(page);
  await expect(page.getByLabel('PDF hall reference')).toContainText('Calibrated PDF crop', {
    timeout: 60_000,
  });
  const imported = await sceneReference(page);
  expect(imported.hall.width).toBeCloseTo(
    (1623.1199951171875 - 1327.530029296875) / 8.820068359375,
    10,
  );
  expect(imported.hall.boundary).toHaveLength(4);
  expect(imported.texture).toBe(true);
  expect(imported.wallBoxes).toBe(0);
  await page.screenshot({ path: 'test-results/pdf-main-planner-actual.png', fullPage: true });
});

async function reviewFixtureHall(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Calibrate scale', exact: true }).click();
  // Exact input isolates persistence precision from mouse/device coordinate precision.
  await page.getByText('Enter precise reference points', { exact: true }).click();
  await page.getByLabel('Reference coordinates: x, y per line').fill('50,340\n250,340');
  await page.getByRole('button', { name: 'Use reference coordinates', exact: true }).click();
  await page.getByLabel('Known distance (m)', { exact: true }).fill('42.5');
  await page.getByRole('button', { name: 'Apply to this page', exact: true }).click();
  await point(page, 150, 250);
  await page.getByRole('button', { name: 'Create editable outline' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Reviewed diagonal hall');
  await page.getByLabel('Name', { exact: true }).blur();
  await page.getByRole('combobox', { name: 'Object type', exact: true }).selectOption('hall');
  await expect(
    page.getByRole('button', { name: 'Save hall & open planner', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('I reviewed this outline and its meaning').check();
}

async function sceneReference(page: Page) {
  return page.evaluate(() => {
    const ng = (window as any).ng;
    const scene = ng.getComponent(document.querySelector('app-scene3d'));
    const planner = ng.getComponent(document.querySelector('app-planner-page'));
    let wallBoxes = 0;
    scene.hallGroup.traverse((child: any) => {
      if (child.geometry?.type === 'BoxGeometry') wallBoxes++;
    });
    const mesh = scene.hallGroup.getObjectByName('pdf-hall-reference');
    const image = mesh?.material.map.image as HTMLCanvasElement | undefined;
    const pixels = image?.getContext('2d')?.getImageData(0, 0, image.width, image.height).data;
    let darkPixels = 0;
    if (pixels)
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 220 || pixels[i + 1] < 220 || pixels[i + 2] < 220) darkPixels++;
    return {
      hall: planner.currentHall(),
      stalls: planner.currentStalls(),
      wallBoxes,
      texture: !!image,
      textureWidth: image?.width,
      textureHeight: image?.height,
      darkPixels,
      planeWidth: mesh?.geometry.parameters.width,
      planeLength: mesh?.geometry.parameters.height,
    };
  });
}

test('PDF hall adapter preserves fractional polygon geometry and requires review and scale', () => {
  const points = [
    { x: 10.25, y: 20 },
    { x: 210.25, y: 20 },
    { x: 250.25, y: 80 },
    { x: 250.25, y: 200 },
    { x: 10.25, y: 200 },
  ];
  const object: PdfObject = {
    id: 'h',
    page: 2,
    name: 'Rotated hall',
    kind: 'hall',
    points,
    sourcePoints: points,
    reviewed: true,
    heightMetres: null,
  };
  const doc = {
    id: 'doc',
    sha256: 'hash',
    objects: [object],
    pageCalibrations: { 2: calibrate({ x: 0, y: 0 }, { x: 200, y: 0 }, 42.5) },
  } as unknown as PdfWorkspace;
  const { hall, binding } = preparePdfHall(doc, object);
  expect(hall.width).toBe(51);
  expect(hall.length).toBe(38.25);
  expect(hall.boundary).toEqual([
    { x: -25.5, z: -19.125 },
    { x: 17, z: -19.125 },
    { x: 25.5, z: -6.375 },
    { x: 25.5, z: 19.125 },
    { x: -25.5, z: 19.125 },
  ]);
  expect(binding.page).toBe(2);
  expect(binding.crop.x).toBe(10.25);
  expect(() => preparePdfHall(doc, { ...object, reviewed: false })).toThrow('Review');
  expect(() => preparePdfHall({ ...doc, pageCalibrations: {} }, object)).toThrow('Calibrate');
  expect(() => preparePdfHall(doc, { ...object, kind: 'stall' })).toThrow('hall');
});

test('Hall Layout upload uses local PDF review; saved hall and reference survive main-planner reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [],
    writes: string[] = [];
  let saved: any = null;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed'));
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(path);
    if (path === '/api/halls' && request.method() === 'POST') {
      saved = { ...request.postDataJSON(), id: 991 };
      return route.fulfill({ status: 201, json: saved });
    }
    return route.fulfill({ json: path === '/api/halls' && saved ? [saved] : [] });
  });
  await page.goto('/planner/halls');
  await page.getByRole('link', { name: /Import a floor plan/ }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'layout.pdf', mimeType: 'application/pdf', buffer: fixture() });
  await expect(page).toHaveURL(/planner\/editor\?.*import=pdf/);
  await expect(page.locator('.drawing-footer')).toBeVisible();
  expect(writes).toEqual([]);
  await reviewFixtureHall(page);
  await page.getByRole('button', { name: 'Save hall & open planner', exact: true }).click();
  await expect(page).toHaveURL(/planner\/editor\?hallId=991/);
  await dismissPlottingRules(page);
  await expect(page.getByLabel('PDF hall reference')).toContainText('Calibrated PDF crop');
  await expect(page.getByText('Offline sample', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No halls on the server', { exact: false })).toHaveCount(0);
  expect(writes).toEqual(['/api/halls']);
  expect(saved.width).toBeCloseTo(51, 12);
  expect(saved.length).toBeCloseTo(38.25, 12);
  expect(saved.boundary).toHaveLength(5);
  expect(saved.pdf).toBeUndefined();
  expect(saved.stalls).toBeUndefined();
  let state = await sceneReference(page);
  expect(state.texture).toBe(true);
  expect(state.wallBoxes).toBe(0);
  expect(state.stalls).toEqual([]);
  expect(state.planeWidth).toBeCloseTo(51, 12);
  expect(state.planeLength).toBeCloseTo(38.25, 12);
  expect(state.textureWidth).toBeLessThanOrEqual(2048);
  expect(state.darkPixels).toBeGreaterThan(100);
  await page.getByLabel('Show original drawing').uncheck();
  expect((await sceneReference(page)).texture).toBe(false);
  await page.getByLabel('Show original drawing').check();
  await page.reload();
  await dismissPlottingRules(page);
  await expect(page.getByLabel('Show original drawing')).toBeVisible();
  state = await sceneReference(page);
  expect(state.hall.boundary).toEqual(saved.boundary);
  expect(state.texture).toBe(true);
  // Reopening the same reviewed snapshot reuses the existing master hall instead of POSTing again.
  await page.getByRole('link', { name: 'Open original PDF / import another hall' }).click();
  await page.getByRole('button', { name: /Reviewed diagonal hall hall/ }).click();
  await page.getByRole('button', { name: 'Save hall & open planner', exact: true }).click();
  await expect(page).toHaveURL(/planner\/editor\?hallId=991/);
  expect(writes).toEqual(['/api/halls']);
  expect(errors).toEqual([]);
});

test('Import plan uses the main scene and keeps the same canvas when stall editing starts', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed'));
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().method());
    return route.fulfill({ json: [] });
  });
  await page.goto('/planner/halls/import');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'geometry.pdf', mimeType: 'application/pdf', buffer: fixture() });
  const next = page.getByRole('button', { name: 'Start stall layout', exact: true });
  await expect(page).toHaveURL(/planner\/editor\?.*import=pdf/);
  await expect(page.getByRole('heading', { name: '3D Floor Planner', exact: true })).toBeVisible();
  await expect(page.locator('app-pdf-three-scene canvas')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ng = (window as any).ng;
        const element = document.querySelector('app-pdf-three-scene');
        if (!element) return false;
        const source = ng.getComponent(element);
        const planner = ng.getComponent(document.querySelector('app-scene3d'));
        return (
          !!source?.sourceReady &&
          source.renderer === planner.renderer &&
          source.scene === planner.scene
        );
      }),
    )
    .toBe(true);
  await expect(next).toBeInViewport();
  await expect(next).toBeEnabled();
  expect(
    await page
      .locator('app-pdf-workspace .status')
      .first()
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await next.click();
  await expect(page).toHaveURL(/planner\/editor\?.*import=pdf/);
  await expect(
    page.getByRole('status').filter({ hasText: 'First mark the hall boundary' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await point(page, 150, 250);
  await page.getByRole('button', { name: 'Create editable outline', exact: true }).click();
  await next.click();
  await expect(page.getByRole('combobox', { name: 'Object type', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Object type', exact: true }).selectOption('hall');
  await next.click();
  await expect(page.getByRole('heading', { name: 'Set drawing scale' })).toBeVisible();
  await page.getByText('Enter precise reference points', { exact: true }).click();
  await page.getByLabel('Reference coordinates: x, y per line').fill('50,340\n250,340');
  await page.getByRole('button', { name: 'Use reference coordinates', exact: true }).click();
  await page.getByLabel('Known distance (m)', { exact: true }).fill('42.5');
  await page.getByRole('button', { name: 'Apply to this page', exact: true }).click();
  await next.click();
  await expect(page.getByLabel('I reviewed this outline and its meaning')).toBeFocused();
  await page.getByLabel('I reviewed this outline and its meaning').check();
  await page.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(page.locator('.document-bar')).toContainText('Saved on this browser');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Object type', exact: true })).toHaveValue(
    'hall',
  );
  await expect(next).toBeInViewport();
  await page.screenshot({ path: 'test-results/pdf-planner-handoff-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/pdf-planner-handoff-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const originalCanvas = await page.locator('app-scene3d canvas').elementHandle();
  await next.click();
  await expect(page).toHaveURL(/planner\/editor\?pdfDocument=/);
  await dismissPlottingRules(page);
  await expect(page.getByLabel('PDF hall reference')).toContainText('Calibrated PDF crop');
  await expect(page.getByRole('heading', { name: '3D Floor Planner' })).toBeVisible();
  expect(
    await originalCanvas!.evaluate(
      (canvas) => canvas === document.querySelector('app-scene3d canvas'),
    ),
  ).toBe(true);
  await expect(page.locator('app-pdf-workspace')).toHaveCount(0);
  const state = await sceneReference(page);
  expect(state.hall.width).toBeCloseTo(51, 12);
  expect(state.hall.boundary).toHaveLength(5);
  expect(state.texture).toBe(true);
  expect(writes).toEqual([]);
});

test('backend failure keeps PDF review; local preview opens the real planner without uploads', async ({
  page,
}) => {
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed'));
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(new URL(route.request().url()).pathname);
    return route.abort('connectionrefused');
  });
  await upload(page);
  await reviewFixtureHall(page);
  await page.getByRole('button', { name: 'Save hall & open planner', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('planner server is unavailable');
  await expect(page).toHaveURL(/planner\/editor\?.*import=pdf/);
  await page.getByRole('button', { name: 'Preview in main planner', exact: true }).click();
  await expect(page).toHaveURL(/planner\/editor\?pdfDocument=/);
  await dismissPlottingRules(page);
  await expect(page.getByLabel('PDF hall reference')).toContainText('local preview');
  await expect(page.getByLabel('Show original drawing')).toBeVisible();
  expect((await sceneReference(page)).hall.width).toBeCloseTo(51, 12);
  await page.reload();
  await dismissPlottingRules(page);
  await expect(page.getByLabel('Show original drawing')).toBeVisible();
  expect((await sceneReference(page)).hall.boundary).toHaveLength(5);
  expect(writes).toEqual(['/api/halls']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('app-scene3d canvas').scrollIntoViewIfNeeded();
  await expect(page.locator('app-scene3d canvas')).toBeInViewport();
  await page.screenshot({ path: 'test-results/pdf-main-planner-mobile.png', fullPage: true });
});
