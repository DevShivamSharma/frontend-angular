import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dismissPlottingRules, plannerState } from './planner-test-helpers';

test('Hall 12A rehearsal: zones, full guided cut, checked publish and exhibitor view', async ({ page, request }) => {
  test.setTimeout(180000);
  const demo = JSON.parse(readFileSync(resolve('../backend-nest/scripts/data/meeting-demo-result.json'),'utf8'));
  await page.addInitScript(() => localStorage.setItem('stall-planner.guided-tour.v1','completed'));
  const errors: string[] = []; page.on('pageerror',e=>errors.push(e.message));
  let savedId: number | null = null;
  await page.goto('/planner/editor?layoutId='+demo.startLayoutId);
  await dismissPlottingRules(page);
  await expect.poll(async () => (await plannerState(page)).hall?.planningZones?.length).toBe(4);
  expect((await plannerState(page)).stalls).toHaveLength(0);
  await page.getByRole('tab',{name:'Assist',exact:true}).click();
  const guide=page.locator('app-assist-panel app-guided-planning'), chat=page.locator('app-assist-panel app-ai-chat');
  await guide.getByRole('button',{name:'Agree',exact:true}).click();
  await guide.getByLabel('Count or fill').fill('fill');
  await guide.getByRole('button',{name:'Create proposal',exact:true}).click();
  await expect(chat.getByRole('button',{name:'Apply',exact:true})).toBeVisible({timeout:90000});
  await chat.getByRole('button',{name:'Apply',exact:true}).click();
  const state=await plannerState(page); expect(state.stalls.length).toBeGreaterThanOrEqual(30); expect(state.audit).toEqual([]);
  try {
    await page.evaluate(()=>{ const s=(window as any).ng.getComponent(document.querySelector('app-planner-page')).store; s.layoutName.set('Rehearsal temporary '+Date.now()); });
    await page.getByRole('tab',{name:/Layouts/}).click();
    const saving=page.waitForResponse(r=>r.url().endsWith('/api/layout/save')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Save New',exact:true}).click();
    const response=await saving; expect(response.ok(),await response.text()).toBe(true); savedId=(await response.json()).layout.id;
    await page.getByRole('button',{name:'Review & publish'}).click();
    const dialog=page.getByRole('dialog',{name:'Review before publishing'});
    await expect(dialog.getByRole('heading',{name:'All placement checks passed'})).toBeVisible();
    await dialog.getByRole('button',{name:'Publish layout',exact:true}).click();
    await expect(dialog).not.toBeVisible();
    const saved=await(await request.get('http://localhost:8080/api/layout/'+savedId)).json();
    expect(saved.layout.status).toBe('PUBLISHED'); expect(saved.stalls.every((s:any)=>s.stallNumber)).toBe(true);
    await page.getByRole('link',{name:'Exhibitor view',exact:true}).click();
    await expect(page.locator('app-exhibitor-view-page')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { if(savedId) expect((await request.delete('http://localhost:8080/api/layout/'+savedId)).ok()).toBe(true); }
});
