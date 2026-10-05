import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlannerStore } from '../planner-store.service';
import type { GateSide } from '../models/stall.model';
@Component({selector:'app-batch-stalls',imports:[FormsModule],styleUrl:'./meeting-controls.css',changeDetection:ChangeDetectionStrategy.OnPush,template:
`<section class="meeting-panel" aria-label="Batch stall actions"><h3>Work with a selection <span>{{store.selectedStalls().length}}</span></h3>
<p>Shift/Ctrl-click stalls, or use the list checkboxes. Select row follows the selected stall’s orientation.</p>
<div class="meeting-actions"><button class="btn-secondary" (click)="store.selectRow()" [disabled]="!store.selectedStall()">Select row</button><button class="btn-secondary" (click)="store.selectAll()" [disabled]="!store.activeStalls().length">Select all</button><button class="btn-mini" (click)="store.selectStall(null)" [disabled]="!store.selectedStalls().length">Clear selection</button></div>
@if(store.selectedStalls().length) {<fieldset [disabled]="store.busy()"><label>Open side<select class="control" [(ngModel)]="side"><option>FRONT</option><option>BACK</option><option>LEFT</option><option>RIGHT</option></select></label>
<div class="meeting-actions"><button class="btn-secondary" (click)="store.batchSides(side,'set')">Set open side</button><button class="btn-secondary" (click)="store.batchSides(side,'toggle')">Toggle side</button><button class="btn-secondary" (click)="store.batchSides(side,'opposite')">Auto opposite</button></div>
<p>Auto opposite opens away from a shared wall. All changes must leave accessible passages.</p>
<div class="meeting-actions"><button class="btn-secondary" (click)="store.mergePavilion()" [disabled]="store.selectedStalls().length<3||store.selectedStalls().length>4">Merge to pavilion</button><button class="btn-mini" (click)="store.cancelSelection()">Cancel selected stalls</button></div></fieldset>}
</section>`})
export class BatchStallsComponent { readonly store=inject(PlannerStore);side:GateSide='FRONT'; }
