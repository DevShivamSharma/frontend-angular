import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';

import { AddStallFormComponent } from './components/add-stall-form.component';
import { CreateHallFormComponent } from './components/create-hall-form.component';
import { EditStallFormComponent } from './components/edit-stall-form.component';
import { SavedLayoutsPanelComponent } from './components/saved-layouts-panel.component';
import { ShopsListComponent } from './components/shops-list.component';
import { WorkingHallPanelComponent } from './components/working-hall-panel.component';
import { PlannerStore } from './planner-store.service';
import { Scene3dComponent, StallMove } from './three/scene3d.component';

/**
 * The single planner screen. Replaces the React `App` shell
 * (App.js:579-601) - the sidebar sections are now their own components and
 * every handler delegates to `PlannerStore`.
 *
 * `PlannerStore` is provided here rather than in root so the whole screen
 * shares one instance and its state is discarded with the page.
 */
@Component({
  selector: 'app-planner-page',
  templateUrl: './planner-page.component.html',
  styleUrl: './planner-page.component.css',
  providers: [PlannerStore],
  imports: [
    WorkingHallPanelComponent,
    CreateHallFormComponent,
    AddStallFormComponent,
    EditStallFormComponent,
    ShopsListComponent,
    SavedLayoutsPanelComponent,
    Scene3dComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlannerPageComponent implements OnInit {
  private readonly store = inject(PlannerStore);

  readonly error = this.store.error;
  readonly stalls = this.store.stalls;
  readonly currentHall = this.store.currentHall;
  readonly currentStalls = this.store.currentStalls;
  readonly selectedStall = this.store.selectedStall;
  readonly selectedStallId = this.store.selectedStallId;
  readonly dragging = this.store.dragging;
  readonly snap = this.store.snap;

  ngOnInit(): void {
    // App.js:500 - the saved layout list is fetched once on mount.
    void this.store.loadList();
  }

  onSelectStall(id: string | number | null): void {
    this.store.selectStall(id);
  }

  onMoveStall(move: StallMove): void {
    this.store.moveStall(move.id, move.x, move.z);
  }

  onDragState(dragging: boolean): void {
    this.store.setDragging(dragging);
  }
}
