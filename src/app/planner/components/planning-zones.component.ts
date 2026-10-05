import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlannerStore } from '../planner-store.service';
import { PLANNING_ZONE_KINDS, PlanningZone } from '../geometry/planning-zones';
import { polygonBounds } from '../geometry/placement-rules';
import { nextPlanningZoneColor, planningZoneColor } from '../geometry/zone-colors';

@Component({selector:'app-planning-zones',imports:[FormsModule],templateUrl:'./planning-zones.component.html',styleUrl:'./meeting-controls.css',changeDetection:ChangeDetectionStrategy.OnPush})
export class PlanningZonesComponent {
  readonly store = inject(PlannerStore);
  readonly kinds = PLANNING_ZONE_KINDS;
  readonly zoneColor = planningZoneColor;
  readonly customColor = signal<string | null>(null);
  private readonly form = viewChild<ElementRef<HTMLElement>>('zoneForm');
  id?: string;
  label = 'Exhibition';
  kind: PlanningZone['kind'] = 'EXHIBITION';
  eventType: PlanningZone['eventType'] = 'B2B';
  x = 0; z = 0; width = 12; length = 12;

  color(): string { return this.customColor() ?? nextPlanningZoneColor(this.store.currentHall()?.planningZones ?? [], this.id); }
  draw(): void { this.store.beginZone({id:this.id,label:this.label,kind:this.kind,eventType:this.eventType,color:this.color()}); }
  setColor(color: string | null): void {
    this.customColor.set(color);
    if (this.store.mode() === 'zone') this.draw();
  }
  edit(zone: PlanningZone): void {
    this.store.setMode('select');
    this.id = zone.id; this.label = zone.label; this.kind = zone.kind; this.eventType = zone.eventType;
    this.customColor.set(planningZoneColor(zone, (this.store.currentHall()?.planningZones ?? []).findIndex(z => z.id === zone.id)));
    const b = polygonBounds(zone.polygon);
    this.x = (b.minX+b.maxX)/2; this.z = (b.minZ+b.maxZ)/2; this.width = b.maxX-b.minX; this.length = b.maxZ-b.minZ;
    this.store.locate([{type:'polygon',points:zone.polygon}]);
    this.form()?.nativeElement.focus({preventScroll:true});
    this.form()?.nativeElement.scrollIntoView({block:'nearest'});
  }
  fresh(): void {
    this.id = undefined; this.label = 'Exhibition'; this.kind = 'EXHIBITION'; this.customColor.set(null);
    this.store.setMode('select');
  }
  save(coordinates = false): void {
    const zones = this.store.currentHall()?.planningZones ?? [];
    const previous = zones.find(z => z.id === this.id);
    if ((coordinates || !previous) && (![this.x,this.z,this.width,this.length].every(Number.isFinite) || this.width<=0 || this.length<=0)) {
      this.store.showError('Enter finite coordinates and positive zone dimensions.'); return;
    }
    const zone: PlanningZone = {
      id: this.id ?? crypto.randomUUID(), label: this.label.trim(), kind: this.kind, eventType: this.eventType, color: this.color(),
      polygon: previous && !coordinates ? previous.polygon : [
        {x:this.x-this.width/2,z:this.z-this.length/2},{x:this.x+this.width/2,z:this.z-this.length/2},
        {x:this.x+this.width/2,z:this.z+this.length/2},{x:this.x-this.width/2,z:this.z+this.length/2}
      ]
    };
    const updated = previous ? zones.map(z => z.id === zone.id ? zone : z) : [...zones, zone];
    if (this.store.setPlanningZones(updated)) { this.id = zone.id; this.customColor.set(zone.color!); }
  }
}
