import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlannerStore } from '../planner-store.service';
import type { PublishIssue } from '../geometry/publish-check';
@Component({selector:'app-publish-dialog',imports:[DecimalPipe,FormsModule],templateUrl:'./publish-dialog.component.html',styleUrls:['./meeting-controls.css','./publish-dialog.component.css'],changeDetection:ChangeDetectionStrategy.OnPush})
export class PublishDialogComponent {
  readonly store=inject(PlannerStore); readonly reason=signal('');readonly opened=signal(false); private readonly dialog=viewChild.required<ElementRef<HTMLDialogElement>>('dialog');private returnFocus:HTMLElement|null=null;
  open():void {this.returnFocus=document.activeElement as HTMLElement;this.reason.set('');this.opened.set(true);this.dialog().nativeElement.showModal();}
  close():void {if(!this.store.busy())this.dialog().nativeElement.close();}
  restoreFocus():void {this.opened.set(false);this.returnFocus?.focus();}
  locate(issue:PublishIssue):void {const stall=this.store.currentStalls().find(s=>String(s.id)===issue.stallId);this.store.locate(issue.violation?.geometry??[],stall);this.close();}
  async publish():Promise<void> {if(await this.store.publishLayout(this.reason()))this.dialog().nativeElement.close();}
}
