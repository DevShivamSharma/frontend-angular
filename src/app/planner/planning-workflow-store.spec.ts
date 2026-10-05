import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE_URL } from '../core/api-base.token';
import { NotifyService } from '../core/notify.service';
import { PlannerStore } from './planner-store.service';
import type { Stall } from './models/stall.model';
import type { PlanningZone } from './geometry/planning-zones';

describe('Meeting workflow store guards',()=>{
 let store:PlannerStore;
 beforeEach(()=>{
  TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:API_BASE_URL,useValue:'http://test.local/api'},
   {provide:NotifyService,useValue:jasmine.createSpyObj('NotifyService',['success','error','confirm','showLoading','hideLoading'])},PlannerStore]});
  store=TestBed.inject(PlannerStore);store.createHall({name:'Meeting guards',shape:'SQUARE',w:100,l:100,r:0});store.setSnap(false);
 });
 it('rejects a geometrically valid AI proposal beyond the utilization budget',()=>{
  const plan=store.reviewPlan([{width:80,length:90,posX:0,posZ:0,openSides:['FRONT']}]);
  expect(plan[0].valid).toBeFalse();expect(plan[0].violations.map(v=>v.code)).toEqual(['MAX_UTILIZATION']);
 });
 it('rechecks utilization at Apply after another stall consumes the available budget',()=>{
  expect(store.reviewPlan([{width:80,length:80,posX:2,posZ:0,openSides:['FRONT']}])[0].valid).toBeTrue();
  store.stalls.set([{id:'added',hallId:store.currentHall()!.id,name:'New area',width:10,length:70,posX:-44,posZ:0,height:3,color:'#fff',gateSide:'FRONT',openSides:['FRONT'],status:'AVAILABLE',stallNumber:null,stallTypeId:null,rotation:0} as Stall]);
  expect(store.audit()).toEqual([]);expect(store.applyPlan()).toBe(0);expect(store.currentStalls().length).toBe(1);
 });
 it('zone rename/retype/delete updates the live audit and refuses an overlapping edit atomically',()=>{
  const zone:PlanningZone={id:'main',label:'Exhibition',kind:'EXHIBITION',eventType:'B2B',polygon:[{x:-20,z:-20},{x:20,z:-20},{x:20,z:20},{x:-20,z:20}]};
  expect(store.setPlanningZones([zone])).toBeTrue();
  store.reviewPlan([{width:6,length:6,posX:0,posZ:0,openSides:['FRONT']}]);expect(store.applyPlan()).toBe(1);
  expect(store.setPlanningZones([{...zone,label:'Media reserved',kind:'MEDIA'}])).toBeTrue();
  expect(store.audit().flatMap(a=>a.violations.map(v=>v.code))).toContain('INTERNAL_ZONE');
  expect(store.setPlanningZones([zone,{...zone,id:'overlapping'}])).toBeFalse();
  expect(store.currentHall()!.planningZones![0].label).toBe('Media reserved');
  store.removeZone('main');expect(store.currentHall()!.planningZones).toEqual([]);expect(store.audit()).toEqual([]);
 });
 it('creating a new hall detaches the previously saved layout before editing',()=>{
  spyOn(Date, 'now').and.returnValue(1000);
  const first = store.createHall({name:'First simultaneous hall',shape:'SQUARE',w:40,l:40,r:0});
  store.selectedSavedId.set(123);store.createHall({name:'Separate hall',shape:'SQUARE',w:40,l:40,r:0});
  expect(store.currentHall()!.id).not.toBe(first.id);
  expect(store.selectedSavedId()).toBeNull();expect(store.publicationStatus()).toBe('Draft');
 });
});
