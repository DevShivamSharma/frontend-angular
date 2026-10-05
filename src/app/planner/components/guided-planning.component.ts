import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AiChatSession } from '../ai-chat-session.service';
@Component({selector:'app-guided-planning',imports:[FormsModule],templateUrl:'./guided-planning.component.html',styleUrl:'./meeting-controls.css',changeDetection:ChangeDetectionStrategy.OnPush})
export class GuidedPlanningComponent {
 readonly session=inject(AiChatSession);readonly modifying=signal(false);readonly error=signal('');
 passage=3;corners=true;internal=true;separation=3;limit=70;zone='';size='6x6';width=6;length=6;count='fill';
 modify():void {const r=this.session.guideRules();this.passage=r.minPassageWidth[this.session.store.eventType()];this.corners=r.enabledRules?.cornerKeepOut!==false;this.internal=r.enabledRules?.internalZones!==false;this.separation=r.eventSeparation??3;this.limit=(r.maxUtilization??.7)*100;this.modifying.set(true);this.error.set('');}
 saveRules():void {
  if(!Number.isFinite(this.passage)||this.passage<1.5||this.passage>5||!Number.isFinite(this.separation)||this.separation<3||this.separation>20||!Number.isFinite(this.limit)||this.limit<=0||this.limit>70){this.error.set('Use aisles 1.5–5 m, event separation 3–20 m, and a utilization limit above 0 and at most 70%.');return;}
  const r=this.session.guideRules(),event=this.session.store.eventType();
  this.session.store.setHallRules({...r,minPassageWidth:{...r.minPassageWidth,[event]:this.passage},eventSeparation:this.separation,maxUtilization:this.limit/100,enabledRules:{...r.enabledRules,cornerKeepOut:this.corners,internalZones:this.internal}});
  this.session.agreeRules();this.modifying.set(false);this.error.set('');
 }
 plan():void {
  const [w,l]=this.size==='custom'?[this.width,this.length]:this.size.split('x').map(Number),n=this.count.trim().toLowerCase();
  if(![w,l].every(v=>Number.isFinite(v)&&v>0&&v<=100)|| (n!=='fill'&&(!/^\d+$/.test(n)||Number(n)<1||Number(n)>500))){this.error.set('Choose positive dimensions up to 100 m and a count from 1 to 500, or fill.');return;}
  if(this.zone&&!this.session.sellableZones().some(z=>z.id===this.zone)){this.error.set('The selected zone changed. Choose a current sellable zone.');return;}
  if(this.session.hall()?.planningZones?.length&&!this.session.sellableZones().length){this.error.set('Add a Food or Exhibition zone before planning stalls.');return;}
  this.error.set('');this.session.draft.set(n==='fill'?'Fill the hall with '+w+'x'+l+' stalls':n+' stalls of '+w+'x'+l);void this.session.send(this.zone||undefined);
 }
}
