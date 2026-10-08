import { test, expect } from '@playwright/test';

test('prepared PDF link opens clean halls and foyers, optional source, and stall editing', async ({ page }) => {
  test.skip(!process.env['PDF_LOCAL_PREVIEW'], 'Requires the loopback preview package server.');
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1', 'completed'));
  await page.goto(`/planner/editor?pdfPreview=${process.env['PDF_LOCAL_PREVIEW']}`);
  const picker = page.getByRole('region', { name: 'Imported PDF halls' });
  await expect(picker.getByRole('button', { name: 'All halls', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('PDF hall reference')).toContainText('Calibrated PDF crop', { timeout: 60_000 });
  const canvas = await page.locator('app-scene3d canvas').elementHandle();
  const scene = () => page.evaluate(() => {
    const p = (window as any).ng.getComponent(document.querySelector('app-planner-page'));
    const s = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    const plane = s.hallGroup.getObjectByName('pdf-hall-reference');
    return { name:s.hall()?.name, reference:s.pdfReference()?.hallId, id:s.hall()?.id,
      hallNames:p.store.halls().map((h:any)=>h.name), vertexCounts:p.store.halls().map((h:any)=>h.boundary.length),
      overview:p.previewOverview(), texture:!!plane?.material?.map?.image,
      floors:s.pdfFloorPlan()?.regions.map((r:any)=>r.name), grid:s.gridGroup.children.length,
      stalls:p.currentStalls().length, savedId:p.store.selectedSavedId() };
  });
  expect((await scene()).hallNames).toEqual(['Hall 10','Hall 9','Hall 8']);
  expect((await scene()).vertexCounts).toEqual([4,4,5]);
  expect((await scene()).floors).toEqual(['Hall 10','Hall 9','Hall 8','Foyer C','Foyer B','Foyer A']);
  expect((await scene()).texture).toBe(false);
  expect((await scene()).grid).toBe(0);
  const sourceToggle = page.getByRole('checkbox',{name:'Show original drawing'});
  await expect(sourceToggle).not.toBeChecked();
  await sourceToggle.check();
  await expect.poll(async () => (await scene()).texture).toBe(true);
  await sourceToggle.uncheck();
  await expect.poll(async () => (await scene()).texture).toBe(false);
  await page.screenshot({ path:'test-results/pdf-three-halls-overview.png' });
  await page.setViewportSize({ width:390,height:844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const s = (window as any).ng.getComponent(document.querySelector('app-scene3d'));
    const floors = s.hallGroup.getObjectByName('pdf-floor-plan').children.filter((o:any)=>o.isMesh);
    s.scene.updateMatrixWorld(true); s.camera.updateMatrixWorld(true);
    for (const floor of floors) {
      const positions = floor.geometry.attributes.position;
      for (let i=0;i<positions.count;i++) {
        const p=s.scene.position.clone().fromBufferAttribute(positions,i).applyMatrix4(floor.matrixWorld).project(s.camera);
        if (Math.abs(p.x)>1.001 || Math.abs(p.y)>1.001) return false;
      }
    }
    return true;
  })).toBe(true);
  await page.screenshot({ path:'test-results/pdf-three-halls-mobile.png', fullPage:true });
  await page.setViewportSize({ width:1440,height:1000 });
  for (const name of ['Hall 10','Hall 9','Hall 8']) {
    await picker.getByRole('button', { name, exact:true }).click();
    await expect.poll(async () => { const s=await scene(); return s.name===name && !s.texture && s.reference===s.id; }).toBe(true);
    const adjacent:Record<string,string[]> = {
      'Hall 10':['Hall 10','Foyer C','Foyer B'], 'Hall 9':['Hall 9','Foyer B','Foyer A'], 'Hall 8':['Hall 8','Foyer A'],
    };
    expect((await scene()).floors).toEqual(adjacent[name]);
    expect((await scene()).stalls).toBe(0);
    const form=page.locator('app-add-stall-form');
    await form.getByLabel('Shop or stall name').fill(`${name} manual preview stall`);
    await form.getByLabel('Width (m)',{exact:true}).fill('3');
    await form.getByLabel('Length (m)',{exact:true}).fill('3');
    await form.getByLabel('Height (m)',{exact:true}).fill('2.5');
    await form.getByRole('button',{name:'Add Shop (then drag on grid)'}).click();
    await expect.poll(async () => (await scene()).stalls).toBe(1);
    // Foyer context must not expand the selected hall's placement boundary.
    expect(await page.evaluate(() => {
      const p=(window as any).ng.getComponent(document.querySelector('app-planner-page'));
      const stall=p.currentStalls()[0], before=[stall.posX,stall.posZ];
      const foyer=p.previewFloorPlan().regions.find((r:any)=>r.kind==='foyer');
      const xs=foyer.boundary.map((v:any)=>v.x), zs=foyer.boundary.map((v:any)=>v.z);
      p.store.moveStall(stall.id,(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2);
      const after=p.currentStalls()[0];
      return before[0]===after.posX && before[1]===after.posZ;
    })).toBe(true);
    await page.screenshot({ path:`test-results/pdf-three-${name.toLowerCase().replace(' ','-')}.png` });
  }
  await picker.getByRole('button',{name:'All halls',exact:true}).click();
  await expect.poll(async () => (await scene()).overview).toBe(true);
  expect(await canvas!.evaluate(c=>c===document.querySelector('app-scene3d canvas'))).toBe(true);
  await picker.getByRole('button',{name:'Hall 9',exact:true}).click();
  await expect.poll(async () => (await scene()).stalls).toBe(1);
  await page.reload();
  await expect(picker.getByRole('button',{name:'All halls',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('PDF hall reference')).toContainText('Calibrated PDF crop',{timeout:60_000});
  expect((await scene()).hallNames).toEqual(['Hall 10','Hall 9','Hall 8']);
  expect((await scene()).stalls).toBe(0);
  expect(errors).toEqual([]);
});
