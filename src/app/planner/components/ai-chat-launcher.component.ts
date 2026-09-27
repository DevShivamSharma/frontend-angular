import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, Injector, ViewChild } from '@angular/core';
import { AiChatSession } from '../ai-chat-session.service';
import { AiChatComponent } from './ai-chat.component';
import { IconComponent } from './icon.component';

@Component({selector:'app-ai-chat-launcher',imports:[AiChatComponent,IconComponent],templateUrl:'./ai-chat-launcher.component.html',styleUrl:'./ai-chat-launcher.component.css',changeDetection:ChangeDetectionStrategy.OnPush})
export class AiChatLauncherComponent {
  readonly session=inject(AiChatSession);
  private readonly injector=inject(Injector);
  @ViewChild('launcher') launcher?:ElementRef<HTMLButtonElement>;
  @ViewChild(AiChatComponent) chat?:AiChatComponent;
  toggle() { this.session.open()?this.close():this.show(); }
  show() { this.session.open.set(true); afterNextRender(()=>this.chat?.focus(),{injector:this.injector}); }
  close() { this.session.open.set(false); this.launcher?.nativeElement.focus(); }
  @HostListener('document:keydown',['$event']) onShortcut(event:KeyboardEvent) {
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') {event.preventDefault();this.show();}
    else if(event.key==='Escape'&&this.session.open()) {event.preventDefault();this.close();}
  }
}
