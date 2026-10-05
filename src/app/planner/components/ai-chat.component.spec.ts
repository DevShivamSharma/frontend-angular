import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AiChatComponent } from './ai-chat.component';
import { AiChatSession } from '../ai-chat-session.service';
import { PlannerStore } from '../planner-store.service';
import { LayoutAssistantService } from '../layout-assistant.service';

describe('AI chat',()=>{
  let fixture:ComponentFixture<AiChatComponent>,session:AiChatSession;
  let store:any,assistant:any;
  const stall={name:'AI-1',posX:0,posZ:0,width:3,length:3};
  beforeEach(async()=>{
    store={currentHall:signal({id:1,name:'Hall 1GF',shape:'SQUARE',width:50,length:50,markers:[{text:'FOYER-1G'}]}),currentStalls:signal([]),eventType:signal('B2C'),grid:signal({cellSize:1}),clearPlan:jasmine.createSpy(),reviewPlan:jasmine.createSpy().and.callFake((p:any[])=>p.map(()=>({valid:true}))),applyPlan:jasmine.createSpy().and.returnValue(1),cancelStall:jasmine.createSpy()};
    assistant={plan:jasmine.createSpy().and.resolveTo({summary:'One stall',stalls:[stall],requestedCount:1,action:'place',notes:[]})};
    await TestBed.configureTestingModule({imports:[AiChatComponent],providers:[AiChatSession,{provide:PlannerStore,useValue:store},{provide:LayoutAssistantService,useValue:assistant}]}).compileComponents();
    fixture=TestBed.createComponent(AiChatComponent);session=TestBed.inject(AiChatSession);session.agreeRules();fixture.detectChanges();
  });
  it('requires agreement before accepting requests and resets it when the hall changes',async()=>{session.reviewRules();fixture.detectChanges();expect(fixture.nativeElement.querySelectorAll('.standard-rules li').length).toBe(7);session.draft.set('3 stalls of 6x6');await session.send();expect(assistant.plan).not.toHaveBeenCalled();session.agreeRules();expect(session.rulesAgreed()).toBeTrue();store.currentHall.set({...store.currentHall(),id:2});expect(session.rulesAgreed()).toBeFalse();});
  it('shows hall-specific example prompts',()=>{expect(fixture.nativeElement.textContent).toContain('FOYER-1G');});
  it('disables send while empty, shows loading, and never applies automatically',async()=>{
    let finish!:(p:any)=>void;assistant.plan.and.returnValue(new Promise(resolve=>finish=resolve));
    expect(fixture.nativeElement.querySelector('.chat-send').disabled).toBeTrue();
    session.draft.set('1 stall of 3x3');const pending=session.send();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.typing')).toBeTruthy();expect(fixture.nativeElement.querySelector('.chat-send').disabled).toBeTrue();
    finish({summary:'One stall',stalls:[stall],notes:[]});await pending;fixture.detectChanges();
    expect(store.reviewPlan).toHaveBeenCalled();expect(store.applyPlan).not.toHaveBeenCalled();expect(session.busy()).toBeFalse();
    expect(assistant.plan.calls.mostRecent().args[1].eventType).toBe('B2C');
  });
  it('rechecks and applies through the existing store',async()=>{session.draft.set('1 stall of 3x3');await session.send();fixture.detectChanges();fixture.nativeElement.querySelector('.chat-apply').click();fixture.detectChanges();expect(store.reviewPlan).toHaveBeenCalledTimes(2);expect(store.applyPlan).toHaveBeenCalledTimes(1);expect(fixture.nativeElement.textContent).toContain('Applied');});
  it('discard clears outlines without adding stalls',async()=>{session.draft.set('1 stall of 3x3');await session.send();session.discard(session.messages()[1]);expect(session.messages()[1].state).toBe('discarded');expect(store.applyPlan).not.toHaveBeenCalled();});
  it('preserves conversation across component instances',async()=>{session.draft.set('1 stall of 3x3');await session.send();fixture.destroy();fixture=TestBed.createComponent(AiChatComponent);fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('One stall');});
  it('expires proposals when the hall changes',async()=>{session.draft.set('1 stall of 3x3');await session.send();store.currentHall.set({...store.currentHall(),id:2});fixture.detectChanges();expect(session.messages()[1].state).toBe('expired');});
  it('ignores late responses after a hall switch',async()=>{let finish!:(p:any)=>void;assistant.plan.and.returnValue(new Promise(resolve=>finish=resolve));session.draft.set('1 stall of 3x3');const pending=session.send();store.currentHall.set({...store.currentHall(),id:2});fixture.detectChanges();finish({stalls:[stall]});await pending;expect(session.messages().length).toBe(1);});
  it('requires another review when placement changes',async()=>{session.draft.set('1 stall of 3x3');await session.send();store.reviewPlan.and.returnValue([{valid:false}]);session.apply(session.messages()[1]);expect(store.applyPlan).not.toHaveBeenCalled();expect(session.messages()[1].fits).toBe(0);});
  it('only removes stalls after Apply',async()=>{assistant.plan.and.resolveTo({summary:'Remove one',action:'clear',stalls:[],removals:[{id:'one',name:'One'}]});session.draft.set('clear all stalls');await session.send();expect(store.cancelStall).not.toHaveBeenCalled();session.apply(session.messages()[1]);expect(store.cancelStall).toHaveBeenCalledWith('one');});
  it('expires removals when current stalls change',async()=>{assistant.plan.and.resolveTo({summary:'Remove one',action:'clear',stalls:[],removals:[{id:'one',name:'One'}]});session.draft.set('clear all stalls');await session.send();store.currentStalls.set([{id:'new'}]);session.apply(session.messages()[1]);expect(store.cancelStall).not.toHaveBeenCalled();expect(session.messages()[1].state).toBe('expired');});
  it('shows recoverable request errors',async()=>{assistant.plan.and.rejectWith(new Error('Offline'));session.draft.set('1 stall of 3x3');await session.send();expect(session.messages()[1].error).toBeTrue();expect(session.busy()).toBeFalse();});
  it('Shift+Enter leaves a newline; Enter sends',()=>{const send=spyOn(session,'send');fixture.componentInstance.onKey(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true}));expect(send).not.toHaveBeenCalled();fixture.componentInstance.onKey(new KeyboardEvent('keydown',{key:'Enter'}));expect(send).toHaveBeenCalled();});
});
