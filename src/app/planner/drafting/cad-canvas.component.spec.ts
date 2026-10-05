import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { CadCanvasComponent } from './cad-canvas.component';
import { DraftingEngine } from './drafting-engine.service';
import { PlannerStore } from '../planner-store.service';

describe('CAD drawing performance and invalidation', () => {
  let fixture: ComponentFixture<CadCanvasComponent>, component: any, engine: any, store: any;
  beforeEach(() => {
    engine = {
      stalls:signal(Array.from({length:500},(_,i)=>({id:String(i),name:String(i),posX:(i%25)*4-48,posZ:Math.floor(i/25)*4-38,width:3,length:3,openSides:['FRONT'],rotation:0}))),
      selection:signal(new Set()),hovered:signal(null),preview:signal(null),cursor:signal(null),snapMark:signal(null),
      layers:signal({base:true,zones:true,services:true,notes:true,stalls:true,labels:true,issues:true}),
      toggles:signal({grid:true,dyn:true}),issueStallIds:signal(new Set()),proposalIndex:signal(-1),request:signal(null),
      view:signal(null),panMode:signal(false),plan:signal({minX:-55,maxX:55,minZ:-45,maxZ:45}),zoomExtents:jasmine.createSpy('zoomExtents')
    };
    store = {currentHall:signal({id:'h',name:'Drawing',shape:'SQUARE',width:110,length:90,radius:0}),proposals:signal(null),grid:signal(null)};
    TestBed.configureTestingModule({imports:[CadCanvasComponent],providers:[{provide:DraftingEngine,useValue:engine},{provide:PlannerStore,useValue:store}]});
    fixture=TestBed.createComponent(CadCanvasComponent);
    fixture.nativeElement.style.cssText='display:block;width:1000px;height:600px';
    fixture.detectChanges();
    component=fixture.componentInstance;
    component.width=1000; component.height=600;
    component.scale=6; component.originX=-60; component.originZ=-50;
  });
  afterEach(()=>fixture.destroy());
  it('invalidates cached geometry for edits, selection, layers, zones, grid and viewport', () => {
    const paint = spyOn(component,'drawBase').and.callThrough();
    component.draw();
    const change = (fn: () => void) => { const before = paint.calls.count(); fn(); component.draw(); expect(paint.calls.count()).toBe(before + 1); };
    change(() => engine.selection.set(new Set(['1'])));
    change(() => engine.hovered.set('2'));
    change(() => engine.stalls.update((stalls: any[]) => stalls.slice(1)));
    change(() => engine.layers.update((layers: any) => ({...layers,labels:false})));
    change(() => store.currentHall.update((hall: any) => ({...hall, planningZones:[{id:'z',label:'Zone',kind:'EXHIBITION',eventType:'B2B',color:'#be185d',polygon:[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:0,z:10}]}]})));
    change(() => store.grid.set({cellSize:2,bounds:{minX:-55,maxX:55,minZ:-45,maxZ:45}}));
    change(() => component.originX++);
    change(() => component.scale++);
    change(() => component.width++);
  });
  it('measures repeated cursor frames on a 500-stall drawing', () => {
    const base=spyOn(component,'drawBase').and.callThrough(),stalls=spyOn(component,'drawStalls').and.callThrough();
    const start=performance.now();
    for(let i=0;i<100;i++) { component.pointer.set({x:i+30,y:50}); engine.cursor.set({x:i/10,z:0}); component.draw(); }
    console.info(JSON.stringify({benchmark:'CAD 500 stalls / 100 cursor frames',ms:Math.round(performance.now()-start),basePaints:base.calls.count(),stallPaints:stalls.calls.count()}));
    expect(base.calls.count()).toBe(1); expect(stalls.calls.count()).toBe(1);
  });
});
