import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlanningZonesComponent } from './planning-zones.component';
import { PlannerStore } from '../planner-store.service';

describe('Planning zone editing', () => {
  it('updates colour without replacing an irregular polygon, or reordering zones', () => {
    const polygon=[{x:0,z:0},{x:12,z:0},{x:8,z:6},{x:0,z:10}];
    const first={id:'first',label:'Exhibition',kind:'EXHIBITION',eventType:'B2B',polygon,color:'#2563eb'};
    const second={...first,id:'second',color:'#c2410c'};
    const store={currentHall:signal({planningZones:[first,second]}),mode:signal('select'),setMode:jasmine.createSpy(),locate:jasmine.createSpy(),showError:jasmine.createSpy(),setPlanningZones:jasmine.createSpy().and.returnValue(true)};
    TestBed.configureTestingModule({providers:[{provide:PlannerStore,useValue:store}]});
    const component=TestBed.runInInjectionContext(()=>new PlanningZonesComponent());
    component.edit(first as any); component.setColor('#047857'); component.save();
    const saved=store.setPlanningZones.calls.mostRecent().args[0];
    expect(saved.map((z: any)=>z.id)).toEqual(['first','second']);
    expect(saved[0].polygon).toBe(polygon);
    expect(saved[0].color).toBe('#047857');
    expect(saved[1]).toBe(second);
    component.width=20; component.save(true);
    expect(store.setPlanningZones.calls.mostRecent().args[0][0].polygon).not.toEqual(polygon);
    component.fresh(); expect(component.color()).not.toBe(first.color); expect(component.color()).not.toBe(second.color);
  });
});
