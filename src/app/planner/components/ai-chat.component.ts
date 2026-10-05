import { GuidedPlanningComponent } from './guided-planning.component';
import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, inject, Input, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AiChatSession } from '../ai-chat-session.service';
import { IconComponent } from './icon.component';

@Component({selector:'app-ai-chat',imports:[DatePipe,IconComponent,GuidedPlanningComponent],templateUrl:'./ai-chat.component.html',styleUrl:'./ai-chat.component.css',changeDetection:ChangeDetectionStrategy.OnPush})
export class AiChatComponent implements AfterViewChecked {
  readonly session=inject(AiChatSession);
  @Input() inputId='ai-assist-input';
  @ViewChild('input') input?:ElementRef<HTMLTextAreaElement>;
  @ViewChild('messages') messages?:ElementRef<HTMLDivElement>;
  private rendered='';
  focus() { this.input?.nativeElement.focus(); }
  useExample(text:string) { this.session.draft.set(text); this.focus(); }
  onInput(event:Event) { this.session.draft.set((event.target as HTMLTextAreaElement).value); this.resize(); }
  onKey(event:KeyboardEvent) { if(event.key==='Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault();void this.session.send();} }
  private resize() { const input=this.input?.nativeElement; if(input) {input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,120)}px`;} }
  ngAfterViewChecked() {
    const signature=`${this.session.messages().length}:${this.session.busy()}:${this.session.draft()}`;
    if(signature===this.rendered) return;
    this.rendered=signature; this.resize();
    const list=this.messages?.nativeElement;
    list?.scrollTo({top:list.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
}
