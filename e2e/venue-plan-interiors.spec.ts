import { expect, test } from '@playwright/test';
import * as T from 'three';
import { buildHallPlanInterior } from '../src/app/home/hall-plan-interiors';
import { HALL_PLANS } from '../src/app/home/hall-plan-data';
import { measureInteriorHalls, walkable, hallToWorld } from '../src/app/home/venue-interiors';
import { createVisitorNavigation, slideVisitor, visitorHallWalkable, campusWalkable } from '../src/app/home/visitor-navigation';
import { findVisitorPath, planVisitorRoute, visitorSegmentClear } from '../src/app/home/visitor-routing';
import { planEntranceGuards } from '../src/app/home/venue-security-placement';
import { referenceVenueGeometry } from './venue-reference-fixture';

test.use({trace:'off',viewport:{width:1440,height:1000},reducedMotion:'reduce',launchOptions:{args:process.platform==='win32'?['--use-angle=d3d11']:['--enable-unsafe-swiftshader']}});

test('supplied hall plans keep columns solid, main halls reachable and every entry/exit clear',()=>{
  test.setTimeout(180000);
  const root=referenceVenueGeometry(),halls=measureInteriorHalls(root),layer=new T.Group(),obstacles=new Map();
  const plans=halls.map(h=>{
    const parent=new T.Group();parent.position.copy(h.center);parent.rotation.y=-h.angle;layer.add(parent);
    const blocks:any[]=[];obstacles.set(h.id,blocks);return buildHallPlanInterior(h,parent,blocks)!;
  });
  expect(halls.map(h=>h.id)).toEqual(['hall1','hall2','hall3','hall4','hall5','hall6','hall14']);
  const nav=createVisitorNavigation(root,halls,obstacles,layer);nav.guards=planEntranceGuards(nav);
  for(const [i,hall] of halls.entries()) {
    const {registration}=plans[i],blocks=obstacles.get(hall.id)!;
    expect(registration.scale).toBeGreaterThan(.5);expect(registration.scale).toBeLessThanOrEqual(1);
    for(const p of registration.plan.columns) {
      const local=registration.point(p);
      expect(walkable(hall,blocks,...local),`${hall.id} column is solid`).toBe(false);
    }
    const allowed=(p:T.Vector3)=>visitorHallWalkable(nav,hall,blocks,p);
    const door=nav.portals.find(p=>p.hall.id===hall.id)!;
    const outer=door.position.clone().addScaledVector(door.outward,door.approach-1);
    const inner=door.position.clone().addScaledVector(door.outward,-4.5);
    const foyer=hallToWorld(hall,...[hall.route![0][0],0,hall.route![0][1]] as [number,number,number]);
    const entrance=registration.point(registration.plan.inward),main=hallToWorld(hall,entrance[0],0,entrance[1]);
    const route=planVisitorRoute(nav,obstacles,undefined,nav.spawn,door);
    expect(route,`${hall.id} automatic arrival`).not.toBeNull();
    for(const [from,to] of [[inner,foyer],[foyer,main],[main,inner]]) {
      const path=findVisitorPath(from,to,nav.bounds,allowed,1);
      expect(path,`${hall.id} entrance connects to the drawn foyer and exhibition floor`).not.toBeNull();
      for(let n=1;n<path!.length;n++)expect(visitorSegmentClear(path![n-1],path![n],allowed)).toBe(true);
    }
    const doorwayAllowed=(p:T.Vector3)=>campusWalkable(nav,p)||allowed(p);
    for(const [from,to] of [[outer,inner],[inner,outer]]) {
      const p=from.clone();slideVisitor(p,to.x-p.x,to.z-p.z,doorwayAllowed);
      expect(Math.hypot(p.x-to.x,p.z-to.z),`${hall.id} fast manual doorway sweep`).toBeLessThan(.02);
    }
    const next=nav.portals[(i+1)%nav.portals.length];
    expect(planVisitorRoute(nav,obstacles,hall,main,next),`${hall.id} can leave for another hall`).not.toBeNull();
  }
  expect(HALL_PLANS.find(p=>p.id==='hall1')!.floor).toContain('First floor');
  plans.forEach(p=>p.dispose());
});

test('actual viewer renders plan interiors and guards across day, night and mobile',async({page},info)=>{
  test.setTimeout(300000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/Shader Error|VALIDATE_STATUS|Entrance security could not load|Interior components unavailable/.test(m.text()))errors.push(m.text());});
  await page.route('https://api.indiatradefair.com/**',r=>r.fulfill({json:{data:{list:[],total:0}}}));
  // Test-only access to the actual renderer; no debug API is shipped in the app.
  await page.route('**/main.js',async route=>{
    const response=await route.fetch(),source=await response.text();
    expect(source).toContain('function renderFrame() {');
    await route.fulfill({response,body:source.replace('function renderFrame() {',
      'function renderFrame() { window.__venueQA={scene,camera,controls,renderer,interiors,visitor,visitorNavigation,securityGuards,frames,renderFrame,invalidate};')});
  });
  await page.goto('/?interior=hall14');
  await page.waitForFunction(()=>{
    const button=document.querySelector('app-home-page')?.shadowRoot?.querySelector<HTMLButtonElement>('#globe-view');
    return button&&!button.disabled&&!button.closest('[inert]')&&(window as any).__venueQA?.interiors;
  },undefined,{timeout:180000});
  await expect(page.locator('.walk-plan-note').filter({hasText:'Plan fitted'})).toBeVisible();
  await page.getByRole('button',{name:'Collapse menu'}).click();
  const stats=await page.evaluate(()=>{
    const q=(window as any).__venueQA;q.frames.pause();
    return {halls:q.interiors.halls.map((h:any)=>h.id),guards:q.securityGuards?.placements.length,
      portals:q.visitorNavigation.portals.length,triangles:q.renderer.info.render.triangles};
  });
  expect(stats.guards).toBe(stats.portals*2);expect(stats.halls).toContain('hall6');
  const capture=async(name:string)=>{const bytes=await page.screenshot({path:info.outputPath(name+'.png')});await info.attach(name,{body:bytes,contentType:'image/png'});};
  await capture('hall14-foyer-day');
  for(const id of ['hall1','hall2','hall3','hall4','hall5','hall6','hall14']) {
    const result=await page.evaluate(id=>{
      const q=(window as any).__venueQA;q.interiors.enter(id);q.frames.pause();
      const h=q.interiors.halls.find((h:any)=>h.id===id);
      q.camera.position.copy(h.center).add({x:0,y:Math.max(h.width,h.depth)*.9,z:8});q.camera.lookAt(h.center);
      q.interiors.update(performance.now());q.renderFrame();
      const supplied=q.interiors.layer.getObjectByName(`${id} supplied floor plan`);
      return {scale:supplied?.userData.uniformDisplayScale,routePoints:h.route.length,blocks:q.interiors.obstacles.get(id).length};
    },id);
    expect(result.scale).toBeGreaterThan(.5);expect(result.routePoints).toBeGreaterThan(5);
    await capture(id+'-plan-overview');
  }
  await page.evaluate(()=>{const q=(window as any).__venueQA;q.interiors.enter('hall14');q.frames.pause();q.interiors.update(performance.now());q.renderFrame();});
  await page.getByRole('button',{name:'Switch to evening'}).click();
  await page.evaluate(()=>{const q=(window as any).__venueQA;q.frames.pause();q.interiors.update(performance.now());q.renderFrame();});
  await capture('hall14-foyer-night');
  await page.setViewportSize({width:390,height:844});
  const collapse=page.getByRole('button',{name:'Collapse menu'});
  if(await collapse.isVisible())await collapse.click();
  await page.evaluate(()=>{const q=(window as any).__venueQA;q.frames.pause();q.renderFrame();});
  await capture('hall14-foyer-night-mobile');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Switch to daylight'}).click();
  const lod=await page.evaluate(()=>{
    const q=(window as any).__venueQA;q.interiors.leave();q.frames.pause();
    const guard=q.securityGuards.placements.find((g:any)=>g.portalId==='hall14');
    q.camera.position.copy(guard.position);q.camera.position.x+=Math.sin(guard.heading)*6;q.camera.position.z+=Math.cos(guard.heading)*6;q.camera.position.y+=2.3;
    q.camera.lookAt(guard.position.clone().add({x:0,y:1.05,z:0}));q.renderFrame();
    return q.securityGuards.group.children.map((o:any)=>({name:o.name,count:o.count,triangles:o.geometry.index.count/3}));
  });
  expect(lod.some((l:any)=>l.triangles===24000&&l.count>0)).toBe(true);
  await capture('security-at-hall14');
  await info.attach('viewer-metrics',{body:JSON.stringify({stats,lod},null,2),contentType:'application/json'});
  expect(errors).toEqual([]);
});
