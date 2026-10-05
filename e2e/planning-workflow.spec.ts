import { test, expect } from '@playwright/test';
import { setupPlanner, plannerState, testHall, testStall } from './planner-test-helpers';
import { batchOpenSides, pavilion } from '../src/app/planner/geometry/stall-batch';
import { planningZoneFor, utilization } from '../src/app/planner/geometry/planning-zones';
import { placementContextFor } from '../src/app/planner/geometry/hall-rules';
import { validatePlacement } from '../src/app/planner/geometry/placement-rules';
import type { Stall } from '../src/app/planner/models/stall.model';

const rectangles=()=>[testStall(1,{posX:-6,width:6,length:6}),testStall(2,{posX:0,width:6,length:6}),testStall(3,{posX:6,width:6,length:6})] as Stall[];
test('batch geometry: pavilion retains area; gaps/booked stalls are refused and opposite faces shared walls',()=>{
 const stalls=rectangles(),merged=pavilion(stalls);expect(merged.width).toBe(18);expect(merged.length).toBe(6);expect(merged.stallNumber).toBeNull();
 expect(()=>pavilion([stalls[0],{...stalls[1],posZ:9},stalls[2]])).toThrow(/without gaps/);
 expect(()=>pavilion([stalls[0],{...stalls[1],status:'BOOKED'},stalls[2]])).toThrow(/available/);
 const pair=[testStall(1,{posZ:-2}),testStall(2,{posZ:2})] as Stall[];
 const result=batchOpenSides(pair,pair,'FRONT','opposite');expect(result.map(s=>s.openSides)).toEqual([['BACK'],['FRONT']]);
 expect(()=>batchOpenSides(pair,pair,'FRONT','toggle')).toThrow(/at least one/);
 const ctx=placementContextFor(testHall as any,result,'B2B');for(const s of ctx.stalls)expect(validatePlacement(s,ctx,s.id).valid).toBe(true);
});
test('zone geometry parity: actual custom footprint, event separation and 70% usage',()=>{
 const rect=(x:number,z:number,w:number,l:number)=>[{x,z},{x:x+w,z},{x:x+w,z:z+l},{x,z:z+l}];
 const hall={...testHall,planningZones:[{id:'a',label:'A',kind:'EXHIBITION',eventType:'B2B',polygon:rect(-20,-20,20,40)},{id:'b',label:'B',kind:'FOOD',eventType:'B2C',polygon:rect(0,-20,20,40)}]} as any;
 const stalls=[testStall(1,{posX:-3}),testStall(2,{posX:3})] as Stall[];const ctx=placementContextFor(hall,stalls,'B2B');
 expect(validatePlacement(ctx.stalls[1],ctx,'2').violations.map(v=>v.code)).toContain('EVENT_SEPARATION');
 expect(planningZoneFor(ctx.stalls[0],hall.planningZones)?.id).toBe('a');expect(utilization(ctx).usedArea).toBe(32);
});

test('zone drawing, coordinates, save/reload, guided proposal and real publication',async({page,request})=>{
 test.setTimeout(120000);
 await setupPlanner(page,[],{...testHall,name:'Workflow browser '+Date.now()});
 let savedId:number|null=null;
 await page.route('**/api/layout/**',async route=>{
  const url=new URL(route.request().url());
  const response=await route.fetch({url:'http://localhost:8080'+url.pathname});
  await route.fulfill({response});
 });
 await page.evaluate(()=>{const s=(window as any).ng.getComponent(document.querySelector('app-planner-page')).store;s.selectedSavedId.set(null);});
 try {
  await page.getByRole('tab',{name:/Zones/}).click();
  const zones=page.locator('app-planning-zones');
  await zones.getByLabel('Zone name',{exact:true}).fill('Exhibition main');
  await zones.getByRole('button',{name:'Draw zone',exact:true}).click();
  const points=await page.evaluate(()=>{
    const c=(window as any).ng.getComponent(document.querySelector('app-scene3d')),box=c.renderer.domElement.getBoundingClientRect();
    return [[-18,-18],[18,12]].map(([x,z])=>{const p=c.camera.position.clone().set(x,0,z).project(c.camera);return {x:box.left+(p.x+1)*box.width/2,y:box.top+(1-p.y)*box.height/2};});
  });
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:12});await page.mouse.up();
  await expect(zones.getByRole('button',{name:'Edit Exhibition main',exact:true})).toBeVisible();
  const drawn=(await plannerState(page)).hall.planningZones;expect(drawn).toHaveLength(1);
  await page.getByRole('tab',{name:'Assist',exact:true}).click();
  const chat=page.locator('app-assist-panel app-ai-chat'),guide=chat.locator('app-guided-planning');
  await expect(guide.getByRole('heading',{name:'Standard rules'})).toBeVisible();
  await expect(guide.locator('ol li')).toHaveCount(7);
  await expect(chat.getByRole('textbox',{name:'Layout request'})).toBeDisabled();
  await guide.getByRole('button',{name:'Modify',exact:true}).click();
  await guide.getByLabel('Aisle width (m)').fill('1');await guide.getByRole('button',{name:'Save rules & agree'}).click();await expect(guide.getByRole('alert')).toContainText('1.5–5');
  await guide.getByLabel('Aisle width (m)').fill('1.5');await guide.getByRole('button',{name:'Save rules & agree'}).click();
  await guide.getByLabel('Planning area').selectOption(drawn[0].id);await guide.getByLabel('Count or fill').fill('3');
  await guide.getByRole('button',{name:'Create proposal',exact:true}).click();
  await expect(chat.getByRole('button',{name:'Apply',exact:true})).toBeVisible({timeout:60000});await chat.getByRole('button',{name:'Apply',exact:true}).click();
  expect((await plannerState(page)).stalls).toHaveLength(3);
  const saveResponse=page.waitForResponse(r=>r.url().endsWith('/api/layout/save')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save layout',exact:true}).click();const saved=await saveResponse;expect(saved.status(),await saved.text()).toBe(201);savedId=(await saved.json()).layout.id;
  await page.evaluate(async id=>{const s=(window as any).ng.getComponent(document.querySelector('app-planner-page')).store;await s.openLayout(id);},savedId);
  expect((await plannerState(page)).hall.planningZones).toEqual(drawn);
  await page.getByRole('button',{name:'Review & publish'}).click();
  const dialog=page.getByRole('dialog',{name:'Review before publishing'});await expect(dialog.getByRole('heading',{name:'All placement checks passed'})).toBeVisible();
  await dialog.getByRole('button',{name:'Publish layout',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('.utilization')).toContainText('Published');
  const detail=await(await request.get('http://localhost:8080/api/layout/'+savedId)).json();expect(detail.layout.status).toBe('PUBLISHED');expect(detail.stalls.every((s:any)=>s.stallNumber)).toBe(true);
  await page.getByRole('link',{name:'Exhibitor view',exact:true}).click();await expect(page.locator('app-exhibitor-view-page')).toBeVisible();
 }finally{if(savedId)await request.delete('http://localhost:8080/api/layout/'+savedId);}
});

test('selection row, atomic batch sides and merge preserve cancelled parent numbers',async({page})=>{
 await setupPlanner(page,rectangles());const batch=page.locator('app-batch-stalls');
 await batch.getByRole('button',{name:'Select row',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).ng.getComponent(document.querySelector('app-planner-page')).store.selectedIds().length)).toBe(3);
 await batch.getByRole('combobox',{name:'Open side',exact:true}).selectOption('BACK');await batch.getByRole('button',{name:'Set open side',exact:true}).click();expect((await plannerState(page)).stalls.every((s:any)=>s.openSides[0]==='BACK')).toBe(true);
 await batch.getByRole('button',{name:'Merge to pavilion'}).click();const state=await plannerState(page);expect(state.stalls.filter((s:any)=>s.status==='CANCELLED')).toHaveLength(3);expect(state.stalls.filter((s:any)=>s.status==='AVAILABLE')).toHaveLength(1);expect(state.audit).toEqual([]);
});

test('publish issues locate; override reason is required and persisted in the UI',async({page})=>{
 const stalls=[testStall(1),testStall(2)];await setupPlanner(page,stalls);let body:any;
 await page.route('**/api/layout/123/publish',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{layout:{id:123,status:'PUBLISHED',publishedAt:new Date().toISOString(),publishOverrides:{reason:body.overrideReason,issues:[{code:'STALL_OVERLAP',message:'Overlap reviewed'}]}},stalls}});});
 await page.getByRole('button',{name:'Review & publish'}).click();const dialog=page.getByRole('dialog',{name:'Review before publishing'});
 await expect(dialog.getByRole('button',{name:'Publish anyway'})).toBeDisabled();await dialog.getByRole('button',{name:'Locate',exact:true}).first().click();expect((await plannerState(page)).focus).toBeTruthy();
 await page.getByRole('button',{name:'Review & publish'}).click();await dialog.getByLabel('Reason for publishing with these issues').fill('Temporary reviewed demo arrangement');await dialog.getByRole('button',{name:'Publish anyway'}).click();await expect(dialog).not.toBeVisible();expect(body.overrideReason).toContain('reviewed');await expect(page.locator('.publication-record')).toContainText('Temporary reviewed demo arrangement');
});

test('desktop and mobile workflow surfaces remain usable',async({page},info)=>{
 await setupPlanner(page,rectangles());
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.evaluate(()=>{document.querySelector('app-planner-page')?.scrollTo(0,0);});await page.getByRole('tab',{name:/Zones/}).click();
  await page.screenshot({path:info.outputPath('zones-'+viewport.width+'.png'),fullPage:true});
  await page.getByRole('tab',{name:'Assist',exact:true}).click();await page.screenshot({path:info.outputPath('rules-'+viewport.width+'.png'),fullPage:true});
  await page.getByRole('button',{name:'Review & publish'}).click();const dialog=page.getByRole('dialog',{name:'Review before publishing'});await expect(dialog).toBeVisible();
  await page.screenshot({path:info.outputPath('publish-'+viewport.width+'.png'),fullPage:true});await dialog.getByRole('button',{name:'Close',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
});
