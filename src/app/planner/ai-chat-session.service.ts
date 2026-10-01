import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LayoutAssistantService, AssistantResponse } from './layout-assistant.service';
import { PlannerStore } from './planner-store.service';
import { extractErrorMessage } from '../core/http-error.util';
import { applyRuleChanges, describeRuleChanges, newNotes } from './geometry/rule-changes';

export interface ChatMessage {
  id: number; role: 'user' | 'assistant'; text: string; time: Date;
  plan?: AssistantResponse; state?: 'pending' | 'applied' | 'discarded' | 'expired';
  fits?: number; error?: boolean; removalSnapshot?: string;
  /** A rules proposal, in words: exactly what Apply will change. */
  ruleLines?: string[];
}

/** One page-scoped session shared by the Assist tab and floating chat. */
@Injectable()
export class AiChatSession {
  readonly store = inject(PlannerStore);
  private readonly assistant = inject(LayoutAssistantService);
  readonly messages = signal<ChatMessage[]>([]);
  readonly draft = signal('');
  readonly busy = signal(false);
  readonly open = signal(false);
  readonly hall = this.store.currentHall;
  private serial = 0;
  private requestId = 0;
  readonly examples = computed(() => {
    const marker = this.hall()?.markers?.find(m=>/foyer/i.test(m.text)) ?? this.hall()?.markers?.[0];
    return [marker ? `12 stalls of 3x3 near ${marker.text}` : '12 stalls of 3x3', '20 stalls of 3x3 along the left wall, 4 m aisles', 'Fill the hall with 3x2 stalls', 'Set the passage width to 4 m'];
  });
  constructor() {
    let previous: unknown = this.hall();
    effect(()=>{
      const hall = this.hall();
      if (hall !== previous) {
        previous = hall; this.requestId++; this.busy.set(false);
        this.expire(); this.store.clearPlan();
      }
    });
  }
  private append(message: Omit<ChatMessage,'id'|'time'>) {
    this.messages.update(items=>[...items,{...message,id:++this.serial,time:new Date()}]);
  }
  private update(id:number,patch:Partial<ChatMessage>) { this.messages.update(items=>items.map(m=>m.id===id?{...m,...patch}:m)); }
  private expire() { this.messages.update(items=>items.map(m=>m.state==='pending'?{...m,state:'expired'}:m)); }
  private snapshot() { return JSON.stringify(this.store.currentStalls()); }
  async send() {
    const requirement=this.draft().trim(), hall=this.hall();
    if (!requirement || requirement.length>500 || !hall || this.busy()) return;
    const id=++this.requestId;
    const removalSnapshot=this.snapshot();
    this.expire(); this.store.clearPlan(); this.busy.set(true); this.draft.set('');
    this.append({role:'user',text:requirement});
    try {
      const plan=await this.assistant.plan(requirement,{...hall,eventType:this.store.eventType()} as typeof hall,this.store.currentStalls(),this.store.grid()?.cellSize??1);
      if (id!==this.requestId || this.hall()!==hall) return;
      if (plan.action==='rules' && plan.rules) {
        const ruleLines=this.ruleLines(plan.rules);
        this.append({role:'assistant',text:ruleLines.length?plan.summary??'':'These rules are already set. Nothing to change.',plan,state:ruleLines.length?'pending':undefined,ruleLines});
        return;
      }
      const reviewed=this.store.reviewPlan(plan.stalls??[]);
      const fits=reviewed.filter(p=>p.valid).length;
      const hasPlan = fits>0 || !!plan.removals?.length;
      this.append({role:'assistant',text:plan.clarification??plan.summary??'No changes proposed.',plan,state:hasPlan?'pending':undefined,fits,removalSnapshot});
    } catch(error) {
      if(id===this.requestId) this.append({role:'assistant',text:`Could not create a proposal. ${extractErrorMessage(error)} Try again.`,error:true});
    } finally { if(id===this.requestId) this.busy.set(false); }
  }
  apply(message:ChatMessage) {
    const current=this.messages().find(m=>m.id===message.id);
    if(current?.state!=='pending' || !current.plan || this.busy()) return;
    if(current.plan.action==='rules') { void this.applyRules(current); return; }
    if(current.plan.action==='clear') {
      if(current.removalSnapshot!==this.snapshot()) {
        this.update(current.id,{state:'expired',text:'The layout changed. Ask again to review the current stalls before removing them.'}); return;
      }
      for(const removal of current.plan.removals??[]) this.store.cancelStall(removal.id);
      this.store.clearPlan(); this.update(current.id,{state:'applied'}); return;
    }
    const reviewed=this.store.reviewPlan(current.plan.stalls);
    const fits=reviewed.filter(p=>p.valid).length;
    // A changed layout deserves another visible review, not silent partial application.
    if(fits!==current.fits) { this.update(current.id,{fits,text:`The layout changed. ${fits} stalls still fit. Review the updated outlines before applying.`}); return; }
    const added=this.store.applyPlan();
    this.update(current.id,{state:added?'applied':'expired',fits:added,text:added?current.text:'No stalls could be applied. Request a new proposal.'});
  }
  private ruleLines(changes:NonNullable<ChatMessage['plan']>['rules']) {
    return changes ? describeRuleChanges(changes,this.hall()?.rules,this.store.eventType(),this.store.plannerRules().map(r=>r.description)) : [];
  }
  private async applyRules(message:ChatMessage) {
    const changes=message.plan!.rules!, hall=this.hall();
    if(!hall) return;
    // The rules may have changed since the proposal: show the new list instead of applying a stale one.
    const lines=this.ruleLines(changes);
    if(JSON.stringify(lines)!==JSON.stringify(message.ruleLines??[])) {
      this.update(message.id,{ruleLines:lines,state:lines.length?'pending':'expired',text:lines.length?'The rules changed. Review the updated list before applying.':'These rules are already set.'}); return;
    }
    this.busy.set(true);
    try {
      this.store.setHallRules(applyRuleChanges(hall.rules,changes,this.store.eventType()));
      await this.store.addPlannerRules(newNotes(changes,this.store.plannerRules().map(r=>r.description)));
      this.update(message.id,{state:'applied',text:'Rules updated. Save the layout to keep them.'});
    } catch(error) {
      this.update(message.id,{state:'expired',error:true,text:`The hall rules changed, but a planner rule could not be added. ${extractErrorMessage(error)}`});
    } finally { this.busy.set(false); }
  }
  discard(message:ChatMessage) {
    if(this.messages().find(m=>m.id===message.id)?.state!=='pending') return;
    this.store.clearPlan(); this.update(message.id,{state:'discarded'});
  }
}
