import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';

import { OrgContextStore } from '../../../core/org/org.stores';
import { PlansApi } from '../../../core/plans/plans-api.service';
import {
  PlanContent,
  PlanObject,
  PlanSeat,
  PlanStall,
  PlanZone,
  stallLabel,
  StallSide,
} from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import { AppDialog } from '../../../core/ui/app-dialog.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { IconComponent } from '../../../shared/icon.component';
import {
  AutoBoothsData,
  AutoBoothsDialogComponent,
  FillRegion,
} from './auto-booths-dialog.component';
import { AutoSeatsData, AutoSeatsDialogComponent } from './auto-seats-dialog.component';
import { FullDemoDialogComponent } from './full-demo-dialog.component';
import { FullDemoPanelComponent } from './full-demo-panel.component';
import { PlannerAgentCtx } from './planner-agent';
import { PlannerAssistantComponent } from './planner-assistant.component';
import { DemoConfig, FullDemoService } from './full-demo.service';
import {
  DrawObjectEvent,
  MoveEvent,
  PickEvent,
  PlannerCanvasComponent,
  PlannerTool,
} from './planner-canvas.component';
import {
  centre,
  DEFAULT_OPEN,
  newId,
  objectOutline,
  pointInRing,
  polygonArea,
  Rect,
  rectRing,
  ringBox,
  round,
  snap,
  stallNumbers,
  stallRect,
  ZONE_COLORS,
  zoneAt,
} from './planner-geometry';
import { PlannerPropertiesComponent, StallPatch } from './planner-properties.component';
import { PlannerStore } from './planner.store';
import { PlannerTourCtx, plannerTour } from './planner-tour';
import { TourOverlayComponent } from '../../../shared/tour/tour-overlay.component';
import { TourService } from '../../../shared/tour/tour.service';
import { AuthService } from '../../../core/auth/auth.service';
import { RowData, RowDialogComponent } from './row-dialog.component';
import { ScaleData, ScaleDialogComponent } from './scale-dialog.component';
import { SeatsData, SeatsDialogComponent } from './seats-dialog.component';

/** Colours of categories on the plan, in the order the hall lists them. */
const CATEGORY_COLORS = [
  '#86efac',
  '#fcd34d',
  '#93c5fd',
  '#f9a8d4',
  '#5eead4',
  '#fdba74',
  '#c4b5fd',
  '#bef264',
];

/** A side of a stall after the stall turns a quarter clockwise. */
const ROTATED: Record<StallSide, StallSide> = {
  top: 'right',
  right: 'bottom',
  bottom: 'left',
  left: 'top',
};
/** A side of a stall after it is mirrored left to right. */
const MIRRORED: Record<StallSide, StallSide> = {
  top: 'top',
  right: 'left',
  bottom: 'bottom',
  left: 'right',
};
/** A side of a stall after it is mirrored top to bottom. */
const FLIPPED: Record<StallSide, StallSide> = {
  top: 'bottom',
  right: 'right',
  bottom: 'top',
  left: 'left',
};
/** Rows the model tree shows; a search finds the rest. */
const TREE_LIMIT = 200;
/** Marks a file Export wrote, so Import knows it. */
const PLAN_FILE_SCHEMA = 'stall-plan/1';
/** Drawings start in slate; Properties changes it. */
const OBJECT_COLOR = '#334155';

/**
 * The stall planner of one hall of an event: zones of any shape, booths one by one or filled
 * automatically, and seats. It opens on the floor version the event keeps, and every change is
 * checked against the rules of this event hall; a change that breaks one is not made.
 */
@Component({
  selector: 'app-planner-page',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    ButtonModule,
    ProgressBarModule,
    TooltipModule,
    IconComponent,
    PlannerCanvasComponent,
    PlannerPropertiesComponent,
    TourOverlayComponent,
    FullDemoPanelComponent,
    PlannerAssistantComponent,
  ],
  providers: [PlannerStore, TourService, FullDemoService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.view(); as v) {
      @let ro = !canEdit();
      @let noStalls = !store.selectedStalls().length || ro || store.busy();
      <div class="planner">
        <app-tour-overlay />
        <nav class="ribbon" aria-label="Tools">
          <div class="group">
            <div class="tools">
              <button
                type="button"
                class="tool"
                (click)="importFile.click()"
                [disabled]="ro || store.busy()"
                pTooltip="Bring in a plan exported from the planner (.json)"
              >
                <app-icon name="upload_file" /><span>Import</span>
              </button>
              <input
                #importFile
                type="file"
                accept=".json,application/json"
                hidden
                (change)="importPlan($event)"
              />
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  (click)="exportPlan()"
                  pTooltip="Download the plan as a file (.json)"
                >
                  <app-icon name="download" /><span>Export</span>
                </button>
              </div>
            </div>
            <span class="group-label"></span>
          </div>
          <div class="group">
            <div class="tools">
              <button
                data-tour="zone-tool"
                type="button"
                class="tool"
                [class.on]="tool() === 'zone-rect'"
                (click)="setTool('zone-rect')"
                [attr.aria-pressed]="tool() === 'zone-rect'"
                [disabled]="ro"
                pTooltip="Zone (Z)"
              >
                <app-icon name="grid_view" /><span>Zone</span>
              </button>
            </div>
            <span class="group-label"></span>
          </div>
          <div class="group" data-tour="fill-group">
            <div class="tools">
              <button
                data-tour="booth-tool"
                type="button"
                class="tool"
                [class.on]="tool() === 'booth'"
                (click)="setTool('booth')"
                [attr.aria-pressed]="tool() === 'booth'"
                [disabled]="ro"
                pTooltip="Booth (B)"
              >
                <app-icon name="storefront" /><span>Booth</span>
              </button>
              <button
                type="button"
                class="tool auto"
                (click)="autoBooths()"
                [disabled]="ro || store.busy()"
              >
                <app-icon name="auto_awesome" /><span>Auto-booths</span>
              </button>
              <button
                type="button"
                class="tool"
                (click)="toBooth()"
                [disabled]="ro || store.busy() || !canMakeBooth()"
                pTooltip="Make a booth of the selected zone or rectangle"
              >
                <app-icon name="crop_square" /><span>To booth</span>
              </button>
              <button type="button" class="tool" (click)="seats()" [disabled]="ro || store.busy()">
                <app-icon name="event_seat" /><span>Seats</span>
              </button>
              <button
                type="button"
                class="tool auto seat"
                (click)="autoSeats()"
                [disabled]="ro || store.busy()"
              >
                <app-icon name="auto_awesome" /><span>Auto-seats</span>
              </button>
            </div>
            <span class="group-label"></span>
          </div>
          <div class="group">
            <div class="tools">
              <button
                data-tour="select-tool"
                type="button"
                class="tool"
                [class.on]="tool() === 'select'"
                (click)="setTool('select')"
                [attr.aria-pressed]="tool() === 'select'"
                pTooltip="Select (V)"
              >
                <app-icon name="near_me" /><span>Select</span>
              </button>
              <button
                type="button"
                class="tool"
                [class.on]="tool() === 'zone-poly'"
                (click)="setTool('zone-poly')"
                [attr.aria-pressed]="tool() === 'zone-poly'"
                [disabled]="ro"
                pTooltip="Polygon zone (P)"
              >
                <app-icon name="hexagon" /><span>Polygon</span>
              </button>
              <button
                type="button"
                class="tool"
                [class.on]="tool() === 'text'"
                (click)="setTool('text')"
                [attr.aria-pressed]="tool() === 'text'"
                [disabled]="ro"
                pTooltip="Text on the plan (T)"
              >
                <app-icon name="object" /><span>Object</span>
              </button>
              @for (pair of drawTools; track $index) {
                <div class="col">
                  @for (t of pair; track t.id) {
                    <button
                      type="button"
                      class="mini"
                      [class.on]="tool() === t.id"
                      (click)="setTool(t.id)"
                      [attr.aria-pressed]="tool() === t.id"
                      [disabled]="ro"
                      [pTooltip]="t.tip"
                    >
                      <app-icon [name]="t.icon" /><span>{{ t.label }}</span>
                    </button>
                  }
                </div>
              }
            </div>
            <span class="group-label">Draw</span>
          </div>
          <div class="group" data-tour="modify-group">
            <div class="tools">
              <button
                type="button"
                class="tool"
                [class.on]="tool() === 'pan'"
                (click)="setTool('pan')"
                [attr.aria-pressed]="tool() === 'pan'"
                pTooltip="Pan (H)"
              >
                <app-icon name="move" /><span>Pan</span>
              </button>
              <div class="col">
                <button
                  data-tour="copy"
                  type="button"
                  class="mini"
                  (click)="copySelection()"
                  [disabled]="noStalls"
                  pTooltip="Copy the selected booths"
                >
                  <app-icon name="content_copy" /><span>Copy</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  (click)="splitSelection()"
                  [disabled]="noStalls || store.selectedStalls().length !== 1"
                  pTooltip="Split the selected booth in two along its longer side"
                >
                  <app-icon name="call_split" /><span>Split</span>
                </button>
                <button
                  type="button"
                  class="mini danger"
                  (click)="removeSelection()"
                  [disabled]="!store.selection() || ro || store.busy()"
                  pTooltip="Delete (Del)"
                >
                  <app-icon name="delete" /><span>Delete</span>
                </button>
              </div>
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  (click)="mergeSelection()"
                  [disabled]="noStalls || store.selectedStalls().length < 2"
                  pTooltip="Join the selected booths into one; together they must make a rectangle"
                >
                  <app-icon name="call_merge" /><span>Merge</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  (click)="rotateSelection()"
                  [disabled]="noStalls"
                  pTooltip="Turn the selected booths a quarter"
                >
                  <app-icon name="rotate" /><span>Rotate</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  (click)="rowOfBooths()"
                  [disabled]="ro || store.busy()"
                  pTooltip="Add booths side by side in a row"
                >
                  <app-icon name="rows" /><span>Row</span>
                </button>
              </div>
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  (click)="mirrorSelection('y')"
                  [disabled]="noStalls"
                  pTooltip="Mirror the selected booths top to bottom"
                >
                  <app-icon name="height" /><span>Mirror</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  [class.on]="tool() === 'mirror-line'"
                  (click)="setTool('mirror-line')"
                  [attr.aria-pressed]="tool() === 'mirror-line'"
                  [disabled]="noStalls"
                  pTooltip="Draw a line to mirror copies of the selected booths across"
                >
                  <app-icon name="line" /><span>Mirror line</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  (click)="scaleSelection()"
                  [disabled]="noStalls"
                  pTooltip="Make the selected booths bigger or smaller"
                >
                  <app-icon name="scale" /><span>Scale</span>
                </button>
              </div>
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  (click)="numberSelection()"
                  [disabled]="noStalls"
                  pTooltip="Number the selected booths from 1, row by row"
                >
                  <app-icon name="numbers" /><span>Number</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  (click)="mirrorSelection('x')"
                  [disabled]="noStalls"
                  pTooltip="Mirror the selected booths left to right"
                >
                  <app-icon name="flip" /><span>Mirror X</span>
                </button>
              </div>
              <div class="col">
                <button
                  data-tour="undo"
                  type="button"
                  class="mini"
                  (click)="store.undo()"
                  [disabled]="!store.canUndo() || ro || store.busy()"
                  pTooltip="Undo (Ctrl+Z)"
                >
                  <app-icon name="undo" /><span>Undo</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  (click)="store.redo()"
                  [disabled]="!store.canRedo() || ro || store.busy()"
                  pTooltip="Redo (Ctrl+Y)"
                >
                  <app-icon name="redo" /><span>Redo</span>
                </button>
              </div>
            </div>
            <span class="group-label">Modify</span>
          </div>
          <div class="group" data-tour="measure-group">
            <div class="tools">
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  [class.on]="tool() === 'measure-distance'"
                  (click)="setTool('measure-distance')"
                  [attr.aria-pressed]="tool() === 'measure-distance'"
                >
                  <app-icon name="measure" /><span>Distance</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  [class.on]="tool() === 'measure-area'"
                  (click)="setTool('measure-area')"
                  [attr.aria-pressed]="tool() === 'measure-area'"
                >
                  <app-icon name="area" /><span>Area</span>
                </button>
              </div>
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  [class.on]="tool() === 'measure-angle'"
                  (click)="setTool('measure-angle')"
                  [attr.aria-pressed]="tool() === 'measure-angle'"
                >
                  <app-icon name="angle" /><span>Angle</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  [class.on]="tool() === 'measure-height'"
                  (click)="setTool('measure-height')"
                  [attr.aria-pressed]="tool() === 'measure-height'"
                >
                  <app-icon name="height" /><span>Height</span>
                </button>
              </div>
            </div>
            <span class="group-label">Measure</span>
          </div>
          <div class="group">
            <div class="tools">
              <div class="col dense">
                <button type="button" class="mini" (click)="zoom(1.25)">
                  <app-icon name="zoom_in" /><span>Zoom in</span>
                </button>
                <button type="button" class="mini" (click)="zoom(0.8)">
                  <app-icon name="zoom_out" /><span>Zoom out</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  [class.on]="splitView()"
                  (click)="splitView.set(!splitView())"
                  [attr.aria-pressed]="splitView()"
                  pTooltip="A second view of the plan beside this one, to zoom on its own"
                >
                  <app-icon name="split_view" /><span>Split view</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  [class.on]="tool() === 'zoom-window'"
                  (click)="setTool('zoom-window')"
                  [attr.aria-pressed]="tool() === 'zoom-window'"
                >
                  <app-icon name="zoom_window" /><span>Zoom window</span>
                </button>
              </div>
              <div class="col">
                <button
                  type="button"
                  class="mini toggle"
                  [class.on]="showGrid()"
                  (click)="showGrid.set(!showGrid())"
                  [attr.aria-pressed]="showGrid()"
                >
                  <app-icon name="grid_on" /><span>Grid</span>
                </button>
                <button
                  type="button"
                  class="mini toggle"
                  [class.on]="showLabels()"
                  (click)="showLabels.set(!showLabels())"
                  [attr.aria-pressed]="showLabels()"
                >
                  <app-icon name="label" /><span>Labels</span>
                </button>
              </div>
            </div>
            <span class="group-label">View</span>
          </div>
          <div class="group">
            <div class="tools">
              <div class="col">
                <button
                  type="button"
                  class="mini"
                  (click)="help()"
                  [pTooltip]="tourFor() ? 'Help & guided tour' : 'Help'"
                >
                  <app-icon name="help" /><span>Help</span>
                </button>
                <button
                  type="button"
                  class="mini"
                  [class.on]="fullscreen()"
                  (click)="toggleFullscreen()"
                  [attr.aria-pressed]="fullscreen()"
                >
                  <app-icon name="fullscreen" /><span>Full</span>
                </button>
              </div>
            </div>
            <span class="group-label">Window</span>
          </div>
          <span class="spacer"></span>
          <div class="actions" data-tour="save-publish">
            @if (canEdit()) {
              <button
                pButton
                class="save"
                [class.saved]="!store.dirty()"
                (click)="save()"
                [disabled]="store.busy() || !store.dirty()"
                pTooltip="Save (Ctrl+S)"
              >
                <app-icon [name]="store.dirty() ? 'save' : 'lock'" />{{
                  store.dirty() ? 'Save' : 'Saved'
                }}
              </button>
            }
            @if (v.canPublish) {
              <button
                type="button"
                class="publish"
                [class.done]="store.upToDate()"
                (click)="publish()"
                [disabled]="store.busy() || store.dirty() || !store.revision() || store.upToDate()"
                [pTooltip]="publishTip()"
              >
                <app-icon name="check_circle" />{{ store.upToDate() ? 'Published' : 'Publish' }}
              </button>
            } @else if (store.published(); as p) {
              <span
                class="published-note"
                [pTooltip]="'Published ' + (p.at | date: 'd MMM y, HH:mm')"
              >
                <app-icon name="check_circle" />Published v{{ p.revision }}
              </span>
            }
          </div>
        </nav>
        @if (ro) {
          <p class="readonly" role="status">
            <app-icon name="visibility" /> {{ v.readOnlyReason }} You are seeing the plan as it was
            last saved.
          </p>
        }
        @if (store.busy()) {
          <p-progressbar mode="indeterminate" class="busy" />
        }

        <div class="body" [class.no-left]="!leftOpen()" [class.no-right]="!rightOpen()">
          @if (leftOpen()) {
            <aside class="side left" aria-label="Plan" data-tour="plan-panel">
              <div class="side-head">
                <h2>Plan</h2>
                <button
                  type="button"
                  class="x"
                  (click)="leftOpen.set(false)"
                  aria-label="Close the plan panel"
                >
                  <app-icon name="close" />
                </button>
              </div>
              <div class="side-body">
                <a
                  class="back"
                  [routerLink]="['/', slug(), 'events', eventId(), 'halls', hallId()]"
                  pTooltip="Back to the hall"
                >
                  <app-icon name="arrow_back" />
                  <span class="title">
                    <b>{{ v.hall.hall.name }}</b>
                    <span class="muted"
                      >{{ v.hall.event.name }} · floor v{{ v.hall.hall.floorVersion }} ·
                      {{ rulesOn() }} rules on</span
                    >
                  </span>
                </a>

                <section class="card">
                  <h3 class="card-title"><app-icon name="trending" />Sales overview</h3>
                  @if (!store.plan().stalls.length) {
                    <p class="small">
                      No booths yet. Draw them with <b>Booth</b> (B), fill the hall with
                      <b>Auto-booths</b>, or bring in a CAD drawing.
                    </p>
                  } @else {
                    <p class="small">
                      <b>{{ stats().total | number }}</b> booths,
                      <b>{{ stats().saleable | number: '1.0-0' }} m²</b> to sell;
                      <b>{{ stats().blocked | number }}</b> blocked.
                    </p>
                  }
                  <button
                    type="button"
                    class="outline soon"
                    aria-disabled="true"
                    pTooltip="Coming soon"
                  >
                    <app-icon name="file_import" />Import a DXF drawing
                  </button>
                </section>

                <section class="card">
                  <button
                    type="button"
                    class="card-toggle"
                    (click)="zonesOpen.set(!zonesOpen())"
                    [attr.aria-expanded]="zonesOpen()"
                  >
                    <app-icon name="grid_view" /><span>Zones</span>
                    <span class="muted count">{{ store.plan().zones.length }}</span>
                    <app-icon name="expand_more" class="chev" [class.open]="zonesOpen()" />
                  </button>
                  @if (zonesOpen()) {
                    @if (!store.plan().zones.length) {
                      <p class="muted small">No zones yet. Draw one with Zone or Polygon.</p>
                    }
                    <ul class="zones">
                      @for (z of store.plan().zones; track z.id) {
                        <li
                          [class.on]="
                            store.selection()?.kind === 'zone' &&
                            store.selection()?.ids?.[0] === z.id
                          "
                        >
                          <button
                            type="button"
                            class="zone"
                            (click)="store.select({ kind: 'zone', ids: [z.id] })"
                          >
                            <span class="swatch" [style.background]="z.color"></span>
                            <span class="zname">{{ z.name }}</span>
                            <span class="muted nums">{{ area(z) | number: '1.0-0' }} m²</span>
                          </button>
                          @if (canEdit()) {
                            <button
                              type="button"
                              class="x"
                              (click)="removeZone(z)"
                              [attr.aria-label]="'Delete ' + z.name"
                              pTooltip="Delete zone"
                            >
                              <app-icon name="close" />
                            </button>
                          }
                        </li>
                      }
                    </ul>
                  }
                </section>

                <section class="card">
                  <h3 class="card-title">
                    Model tree <span class="muted">({{ treeCount() | number }})</span>
                  </h3>
                  <label class="search">
                    <app-icon name="search" />
                    <input
                      type="search"
                      placeholder="Find in the model"
                      [value]="treeQuery()"
                      (input)="treeQuery.set($any($event.target).value)"
                      aria-label="Find in the model"
                    />
                  </label>
                  @if (tree().items.length) {
                    <ul class="tree">
                      @for (item of tree().items; track item.id) {
                        <li>
                          <button
                            type="button"
                            [class.on]="store.selection()?.ids?.includes(item.id)"
                            (click)="store.select({ kind: item.kind, ids: [item.id] })"
                          >
                            @if (item.color) {
                              <span class="swatch" [style.background]="item.color"></span>
                            } @else {
                              <app-icon name="storefront" />
                            }
                            <span class="zname">{{ item.label }}</span>
                          </button>
                        </li>
                      }
                    </ul>
                    @if (tree().more > 0) {
                      <p class="muted small">
                        {{ tree().more | number }} more; search to find them.
                      </p>
                    }
                  } @else if (treeQuery()) {
                    <p class="muted small">Nothing matches “{{ treeQuery() }}”.</p>
                  }
                </section>

                @if (store.categories().length) {
                  <section class="card">
                    <h3 class="card-title">Categories</h3>
                    <ul class="legend">
                      @for (c of store.categories(); track c.id; let i = $index) {
                        <li>
                          <span class="swatch" [style.background]="colorOf(i)"></span>{{ c.name }}
                        </li>
                      }
                    </ul>
                  </section>
                }

                <section class="card">
                  <h3 class="card-title">Rules</h3>
                  <p class="muted small">
                    Every change is checked against the {{ rulesOn() }} rules on for this hall. A
                    change that breaks one is not made; the message says why.
                  </p>
                </section>
              </div>
            </aside>
          }

          <div class="stage" [class.split]="splitView()">
            <app-planner-canvas
              #canvas
              data-tour="canvas"
              class="canvas"
              [floor]="v.hall.floor"
              [plan]="store.plan()"
              [selection]="store.selection()"
              [tool]="tool()"
              [snapStep]="snapStep()"
              [categoryColors]="categoryColors()"
              [readonly]="ro"
              [showGrid]="showGrid()"
              [showLabels]="showLabels()"
              (drawRect)="drawn($event)"
              (drawPolygon)="zoneFromPolygon($event)"
              (drawObject)="addObject($event)"
              (mirrorLine)="mirrorAcross($event)"
              (placeAt)="placeBooth($event)"
              (pick)="picked($event)"
              (move)="moved($event)"
            />
            @if (splitView()) {
              <!-- The same plan again, to look at elsewhere: pan and zoom only. -->
              <app-planner-canvas
                class="canvas second"
                [floor]="v.hall.floor"
                [plan]="store.plan()"
                [selection]="store.selection()"
                tool="pan"
                [categoryColors]="categoryColors()"
                [readonly]="true"
                [showGrid]="showGrid()"
                [showLabels]="showLabels()"
              />
            }
            @if (!leftOpen()) {
              <button
                type="button"
                class="reopen left"
                (click)="leftOpen.set(true)"
                aria-label="Open the plan panel"
              >
                <app-icon name="left_panel_open" />
              </button>
            }
            @if (!rightOpen()) {
              <button
                type="button"
                class="reopen right"
                (click)="rightOpen.set(true)"
                aria-label="Open the properties panel"
              >
                <app-icon name="left_panel_close" />
              </button>
            }
            @if (demo.active()) {
              <app-full-demo-panel />
            } @else {
              <section class="tour" [class.closed]="!tourOpen()">
                <button
                  type="button"
                  class="tour-head"
                  (click)="tourOpen.set(!tourOpen())"
                  [attr.aria-expanded]="tourOpen()"
                >
                  <app-icon name="play" />
                  <b>Help &amp; guided tour</b>
                  <app-icon name="expand_more" class="chev" [class.open]="tourOpen()" />
                </button>
                @if (tourOpen()) {
                  @if (tourFor()) {
                    <p class="small">
                      New here, or showing someone round? The guided tour takes you step by step:
                      it lights up one thing, you do it, and it moves on by itself.
                    </p>
                    <div class="tour-actions">
                      <button pButton type="button" (click)="startTour()">
                        <app-icon name="play" />Start the guided tour
                      </button>
                    </div>
                  } @else {
                    <p class="small">
                      Mark areas with <b>Zone</b> or <b>Polygon</b>, place stalls with
                      <b>Booth</b> or <b>Auto-booths</b>, then <b>Save</b>. Every change is checked
                      against this hall's rules.
                    </p>
                  }
                  <p class="small">
                    Or watch the whole flow: the <b>full demo</b> makes a new hall and does each
                    step itself, from a drawing to a 3D tour.
                  </p>
                  <div class="tour-actions">
                    <button
                      pButton
                      [outlined]="true"
                      type="button"
                      (click)="fullDemo()"
                      [disabled]="!!demoBlocker()"
                      [pTooltip]="demoBlocker() ?? ''"
                    >
                      <app-icon name="play" />Full demo: hall to 3D
                    </button>
                  </div>
                  @if (demoBlocker(); as why) {
                    <p class="small muted">{{ why }}</p>
                  }
                }
              </section>
            }
            @if (assistantOpen()) {
              <app-planner-assistant
                [slug]="slug()"
                [eventId]="eventId()"
                [hallId]="hallId()"
                [ctx]="agentCtx"
                (closed)="assistantOpen.set(false)"
              />
            } @else {
              <button
                type="button"
                class="ai"
                (click)="assistantOpen.set(true)"
                pTooltip="Ask about this hall, typed or spoken"
              >
                <app-icon name="auto_awesome" />AI Assistant
              </button>
            }
          </div>

          @if (rightOpen()) {
            <aside class="side right" aria-label="Properties">
              <div class="side-head">
                <h2>Properties</h2>
                <button
                  type="button"
                  class="x"
                  (click)="rightOpen.set(false)"
                  aria-label="Close the properties panel"
                >
                  <app-icon name="close" />
                </button>
              </div>
              <div class="side-body">
                <section class="card">
                  <app-planner-properties
                    [store]="store"
                    [readonly]="ro"
                    (patch)="patchStalls($event)"
                    (zonePatch)="patchZone($event)"
                    (seatCategory)="seatCategory($event)"
                    (objectPatch)="patchObjects($event)"
                    (remove)="removeSelection()"
                  />
                </section>
                <section class="card">
                  <h3 class="card-title">Hall Statistics</h3>
                  <dl class="stats">
                    <dt>Total Booths</dt>
                    <dd>{{ stats().total | number }}</dd>
                    <dt>Available</dt>
                    <dd class="ok">{{ stats().available | number }}</dd>
                    <dt>Reserved</dt>
                    <dd class="bad">0</dd>
                    <dt>Booked</dt>
                    <dd class="bad">0</dd>
                    <dt>Blocked</dt>
                    <dd>{{ stats().blocked | number }}</dd>
                    <dt>Zones</dt>
                    <dd>{{ store.plan().zones.length }}</dd>
                    <dt>Seats</dt>
                    <dd>{{ store.plan().seats.length | number }}</dd>
                    <dt>Hall Size</dt>
                    <dd>
                      {{ v.hall.hall.width | number: '1.0-1' }} ×
                      {{ v.hall.hall.depth | number: '1.0-1' }} m
                    </dd>
                  </dl>
                  <dl class="stats total">
                    <dt>Total Saleable Area</dt>
                    <dd>{{ stats().saleable | number: '1.0-0' }} m²</dd>
                  </dl>
                </section>
              </div>
            </aside>
          }
        </div>
      </div>
    } @else {
      <p-progressbar mode="indeterminate" />
    }
  `,
  styles: `
    :host {
      display: block;
      height: calc(100dvh - 64px);
    }
    .planner {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--app-surface);
    }
    .spacer {
      flex: 1;
    }
    .ribbon {
      display: flex;
      align-items: stretch;
      gap: 0;
      padding: 4px 8px 0;
      border-bottom: 1px solid var(--app-outline-variant);
      background: var(--app-surface-container-lowest);
      overflow-x: auto;
    }
    .group {
      display: grid;
      grid-template-rows: 1fr auto;
      justify-items: center;
      padding: 0 8px;
      border-right: 1px solid var(--app-outline-variant);
    }
    .tools {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .col {
      display: grid;
      align-content: center;
      gap: 2px;
      padding: 0 2px;
    }
    .col.dense {
      gap: 0;
    }
    .group-label {
      min-height: 18px;
      padding: 2px 0 4px;
      font: var(--app-label-small);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--app-on-surface-variant);
    }
    .tool {
      display: grid;
      justify-items: center;
      gap: 4px;
      min-width: 56px;
      padding: 8px 6px 6px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--app-on-surface);
      font: var(--app-label-small);
      cursor: pointer;
      white-space: nowrap;
    }
    .tool app-icon {
      font-size: 1.15rem;
    }
    .mini {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--app-on-surface);
      font: var(--app-label-small);
      cursor: pointer;
      white-space: nowrap;
    }
    .mini app-icon {
      font-size: 0.8rem;
    }
    .tool:hover:not(:disabled):not(.soon),
    .tool:focus-visible,
    .mini:hover:not(:disabled):not(.soon),
    .mini:focus-visible {
      background: var(--app-surface-container);
    }
    .tool.on,
    .mini.on {
      background: var(--app-on-surface);
      color: var(--app-surface);
    }
    .tool.on:hover,
    .mini.on:hover {
      background: var(--app-on-surface) !important;
    }
    .tool.auto {
      color: light-dark(#15803d, #4ade80);
    }
    .tool.seat {
      color: light-dark(#7e22ce, #c084fc);
    }
    .danger {
      color: var(--app-error);
    }
    .tool:disabled,
    .mini:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .soon {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .actions {
      position: sticky;
      right: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 4px 0 12px;
      background: var(--app-surface-container-lowest);
      box-shadow: -12px 0 12px -8px rgb(0 0 0 / 0.12);
    }
    .save {
      --p-button-primary-background: #16a34a;
      --p-button-primary-border-color: #16a34a;
      --p-button-primary-hover-background: #15803d;
      --p-button-primary-hover-border-color: #15803d;
      gap: 6px;
    }
    .save.saved {
      --p-button-primary-background: #94a3b8;
      --p-button-primary-border-color: #94a3b8;
    }
    .publish:disabled:not(.done) {
      opacity: 0.5;
      cursor: default;
    }
    .publish:not(:disabled) {
      cursor: pointer;
    }
    .publish.done {
      background: #16a34a;
    }
    .published-note {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #15803d;
      font: var(--app-label-large);
    }
    .publish {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 0;
      border-radius: 8px;
      background: #0f2a4a;
      color: #fff;
      font: var(--app-label-large);
    }
    .readonly {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      padding: 10px 16px;
      background: #fef9c3;
      color: #713f12;
      font: var(--app-body-medium);
    }
    .busy {
      position: absolute;
      inset: 0 0 auto;
      z-index: 2;
      height: 3px;
    }
    .body {
      flex: 1;
      display: grid;
      grid-template-columns: 256px minmax(0, 1fr) 260px;
      min-height: 0;
    }
    .body.no-left {
      grid-template-columns: minmax(0, 1fr) 260px;
    }
    .body.no-right {
      grid-template-columns: 256px minmax(0, 1fr);
    }
    .body.no-left.no-right {
      grid-template-columns: minmax(0, 1fr);
    }
    @media (max-width: 1100px) {
      .body,
      .body.no-right {
        grid-template-columns: minmax(0, 1fr) 260px;
      }
      .body.no-right {
        grid-template-columns: minmax(0, 1fr);
      }
      .left {
        display: none !important;
      }
    }
    .side {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--app-surface-container-lowest);
    }
    .left {
      border-right: 1px solid var(--app-outline-variant);
    }
    .right {
      border-left: 1px solid var(--app-outline-variant);
    }
    .side-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 10px 10px 14px;
      border-bottom: 1px solid var(--app-outline-variant);
    }
    .side-head h2 {
      margin: 0;
      font: var(--app-label-medium);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .side-body {
      display: grid;
      gap: 10px;
      align-content: start;
      padding: 10px;
      overflow: auto;
    }
    .back {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 4px;
      border-radius: 8px;
      color: inherit;
      text-decoration: none;
    }
    .back:hover {
      background: var(--app-surface-container);
    }
    .title {
      display: grid;
      min-width: 0;
    }
    .title span {
      font: var(--app-body-small);
    }
    .card {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      background: var(--app-surface-container-lowest);
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font: var(--app-title-small);
      font-weight: 700;
    }
    .card-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: var(--app-title-small);
      font-weight: 700;
      cursor: pointer;
      text-align: left;
    }
    .card-toggle .count {
      flex: 1;
      font-weight: 400;
    }
    .chev {
      transition: transform 0.15s;
    }
    .chev.open {
      transform: rotate(180deg);
    }
    .outline {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
      background: none;
      color: inherit;
      font: var(--app-label-large);
    }
    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
      color: var(--app-on-surface-variant);
    }
    .search input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: none;
      background: none;
      color: var(--app-on-surface);
      font: var(--app-body-medium);
    }
    .search:focus-within {
      border-color: var(--app-primary);
    }
    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
    }
    .canvas {
      position: absolute;
      inset: 0;
    }
    .split .canvas {
      right: 50%;
    }
    .split .canvas.second {
      left: 50%;
      right: 0;
      border-left: 2px solid var(--app-outline-variant);
    }
    .reopen {
      position: absolute;
      top: 12px;
      padding: 8px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 8px;
      background: #fff;
      color: #334155;
      cursor: pointer;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
    }
    .reopen.left {
      left: 12px;
      top: 48px;
    }
    .reopen.right {
      right: 140px;
    }
    .tour {
      position: absolute;
      left: 12px;
      bottom: 12px;
      width: min(370px, calc(100% - 200px));
      padding: 10px 14px;
      border: 1px solid var(--app-outline-variant);
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
    }
    .tour.closed {
      width: auto;
    }
    .tour-head {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: #1e293b;
      font: var(--app-title-small);
      cursor: pointer;
      text-align: left;
    }
    .tour-head b {
      flex: 1;
    }
    .tour-actions {
      display: flex;
      gap: 8px;
      margin: 10px 0 2px 30px;
    }
    .tour p {
      margin: 6px 0 0 30px;
      color: #334155;
    }
    .ai {
      position: absolute;
      right: 12px;
      bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border: 0;
      border-radius: 999px;
      background: #0f2a4a;
      color: #fff;
      font: var(--app-label-large);
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
    }
    .zones,
    .legend,
    .tree {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 2px;
    }
    .tree {
      max-height: 240px;
      overflow: auto;
    }
    .zones li {
      display: flex;
      align-items: center;
      border-radius: 8px;
    }
    .zones li.on,
    .tree button.on {
      background: var(--app-secondary-container);
    }
    .zone,
    .tree button {
      flex: 1;
      display: flex;
      gap: 8px;
      align-items: center;
      width: 100%;
      min-width: 0;
      padding: 6px 8px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: inherit;
      font: var(--app-body-medium);
      text-align: left;
      cursor: pointer;
    }
    .tree button:hover {
      background: var(--app-surface-container);
    }
    .zname {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .x {
      border: 0;
      background: none;
      color: var(--app-on-surface-variant);
      padding: 6px;
      border-radius: 6px;
      cursor: pointer;
    }
    .x:hover {
      color: var(--app-error);
    }
    .legend li {
      display: flex;
      gap: 8px;
      align-items: center;
      font: var(--app-body-small);
    }
    .swatch {
      width: 14px;
      height: 14px;
      flex: none;
      border-radius: 3px;
      border: 1px solid rgb(0 0 0 / 0.15);
    }
    .small {
      font: var(--app-body-small);
      margin: 0;
    }
    .nums {
      font-variant-numeric: tabular-nums;
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 12px;
      margin: 0;
      font-size: 13px;
    }
    .stats dt {
      color: var(--app-on-surface-variant);
    }
    .stats dd {
      margin: 0;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .stats .ok {
      color: #16a34a;
    }
    .stats .bad {
      color: var(--app-error);
    }
    .stats.total {
      grid-template-columns: 1fr auto;
      padding-top: 8px;
      border-top: 1px solid var(--app-outline-variant);
    }
  `,
})
export class PlannerPageComponent {
  /** From the route. */
  readonly eventId = input.required<string>();
  readonly hallId = input.required<string>();

  protected readonly store = inject(PlannerStore);
  private readonly api = inject(PlansApi);
  private readonly dialog = inject(AppDialog);
  private readonly notifier = inject(Notifier);
  private readonly confirm = inject(ConfirmService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly context = inject(OrgContextStore);
  protected readonly slug = this.context.slug;
  private readonly auth = inject(AuthService);
  protected readonly tour = inject<TourService<PlannerTourCtx>>(TourService);
  protected readonly demo = inject(FullDemoService);
  private readonly router = inject(Router);
  /** The guided tour is for the organiser's admin and architect. */
  protected readonly tourFor = computed(() => this.context.eventScoped());
  private readonly canvas = viewChild<PlannerCanvasComponent>('canvas');

  protected readonly tool = signal<PlannerTool>('select');
  protected readonly canEdit = this.store.canEdit;

  protected readonly showGrid = signal(true);
  protected readonly showLabels = signal(true);
  protected readonly leftOpen = signal(true);
  protected readonly rightOpen = signal(true);
  protected readonly zonesOpen = signal(true);
  protected readonly tourOpen = signal(true);
  protected readonly assistantOpen = signal(false);
  protected readonly fullscreen = signal(false);
  protected readonly treeQuery = signal('');
  protected readonly splitView = signal(false);

  /** Line, Rect, Circle and Polyline, two to a column as the ribbon shows them. */
  protected readonly drawTools: Array<
    Array<{ id: PlannerTool; label: string; icon: string; tip: string }>
  > = [
    [
      { id: 'line', label: 'Line', icon: 'line', tip: 'Line (L)' },
      { id: 'rect', label: 'Rect', icon: 'crop_square', tip: 'Rectangle (R)' },
    ],
    [
      { id: 'circle', label: 'Circle', icon: 'circle', tip: 'Circle (C)' },
      { id: 'polyline', label: 'Polyline', icon: 'polyline', tip: 'Polyline' },
    ],
  ];

  /** A zone, or one drawn rectangle, can become a booth. */
  protected readonly canMakeBooth = computed(() => {
    const objects = this.store.selectedObjects();
    return !!this.store.selectedZone() || (objects.length === 1 && objects[0].kind === 'rect');
  });

  /** The 1 m grid profile asks for whole metres; else half-metre steps. */
  protected readonly snapStep = computed(() =>
    this.store.view()?.hall.rules.drawingProfile === 'grid' ? 1 : 0.5,
  );
  protected readonly rulesOn = computed(() => this.store.view()?.hall.hall.rulesOn ?? 0);
  protected readonly categoryColors = computed(
    () => new Map(this.store.categories().map((c, i) => [c.id, this.colorOf(i)] as const)),
  );
  /** Booths of the plan; reserved and booked come with bookings, not the plan. */
  protected readonly stats = computed(() => {
    const stalls = this.store.plan().stalls;
    const open = stalls.filter((s) => !s.isBlocked);
    return {
      total: stalls.length,
      blocked: stalls.length - open.length,
      available: open.filter((s) => s.isActive).length,
      saleable: open.reduce((sum, s) => sum + s.width * s.depth, 0),
    };
  });
  protected readonly treeCount = computed(
    () => this.store.plan().zones.length + this.store.plan().stalls.length,
  );
  /** Zones and stalls matching the search, the first {@link TREE_LIMIT} of them. */
  protected readonly tree = computed(() => {
    const q = this.treeQuery().trim().toLowerCase();
    const p = this.store.plan();
    const zones = p.zones
      .filter((z) => !q || z.name.toLowerCase().includes(q))
      .map((z) => ({ kind: 'zone' as const, id: z.id, label: z.name, color: z.color }));
    const stalls = p.stalls
      .filter((s) => !q || stallLabel(s).toLowerCase().includes(q))
      .map((s) => ({
        kind: 'stall' as const,
        id: s.id,
        label: `Stall ${stallLabel(s)}`,
        color: null,
      }));
    const all = [...zones, ...stalls];
    return { items: all.slice(0, TREE_LIMIT), more: all.length - TREE_LIMIT };
  });

  constructor() {
    effect(() => {
      const [eventId, hallId] = [this.eventId(), this.hallId()];
      untracked(() => void this.load(eventId, hallId));
    });
  }

  private async load(eventId: string, hallId: string): Promise<void> {
    try {
      const view = await firstValueFrom(this.api.get(this.slug(), eventId, hallId));
      this.store.load(this.slug(), eventId, hallId, view);
      this.autoTour();
    } catch {
      // The error interceptor has shown it.
    }
  }

  /** Leaving with unsaved changes asks first (see the route's guard). */
  canLeave(): Promise<boolean> | boolean {
    if (!this.store.dirty()) return true;
    return this.confirm.confirm({
      title: 'Leave without saving?',
      message: 'The plan has changes that are not saved. They are lost if you leave.',
      confirmLabel: 'Leave',
      destructive: true,
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }

  @HostListener('document:fullscreenchange')
  protected fullscreenChanged(): void {
    this.fullscreen.set(document.fullscreenElement === this.host.nativeElement);
  }

  @HostListener('window:keydown', ['$event'])
  protected key(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable], .p-dialog')) return;
    // The tour has the keyboard on its info steps; on "Your turn" steps shortcuts work.
    if (this.tour.active() && !this.tour.step()?.action) return;
    // The full demo is drawing: keys would change the plan under it.
    if (this.demo.active() && !this.demo.finished()) return;
    if (!this.canEdit()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const canvas = this.canvas();
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      void this.copySelection();
    } else if (!ctrl && e.key === '3') {
      canvas?.enter3d();
    } else if (!ctrl && e.key === '2') {
      canvas?.leave3d();
    } else if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
    } else if (e.key === 'Escape') {
      if (canvas?.drawing) canvas.cancel();
      else if (this.tool() !== 'select') this.tool.set('select');
      else this.store.select(null);
    } else if (e.key === 'Enter') {
      canvas?.finishPolygon();
    } else if (e.key === 'Backspace' && canvas?.undoCorner()) {
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.removeSelection();
    } else if (!ctrl && !e.altKey) {
      const tool = (
        {
          v: 'select',
          h: 'pan',
          z: 'zone-rect',
          p: 'zone-poly',
          b: 'booth',
          l: 'line',
          r: 'rect',
          c: 'circle',
          t: 'text',
        } as const
      )[e.key.toLowerCase() as 'v'];
      if (tool) this.setTool(tool);
    }
  }

  protected setTool(tool: PlannerTool): void {
    this.tool.set(tool);
  }

  protected colorOf(i: number): string {
    return CATEGORY_COLORS[i % CATEGORY_COLORS.length];
  }

  protected area(z: PlanZone): number {
    return polygonArea(z.polygon);
  }

  protected zoom(factor: number): void {
    this.canvas()?.zoomBy(factor);
  }

  protected toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.host.nativeElement.requestFullscreen();
  }

  // ---- import and export --------------------------------------------------------------------

  /** The plan as a file, to keep or to bring into another hall's planner. */
  protected exportPlan(): void {
    const v = this.store.view();
    if (!v) return;
    const file = {
      schema: PLAN_FILE_SCHEMA,
      hall: v.hall.hall.name,
      event: v.hall.event.name,
      exportedAt: new Date().toISOString(),
      plan: this.store.plan(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${v.hall.event.name} - ${v.hall.hall.name} plan.json`.replace(
      /[\\/:*?"<>|]/g,
      '',
    );
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Replaces the plan with one from an exported file, after asking. Everything gets new ids, so
   * a plan can be brought in twice or into another hall; the rules check it as any change.
   */
  protected async importPlan(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let content: PlanContent;
    try {
      const parsed = JSON.parse(await file.text()) as { schema?: string; plan?: PlanContent };
      if (parsed.schema !== PLAN_FILE_SCHEMA || !parsed.plan) throw new Error();
      content = parsed.plan;
      if (![content.zones, content.stalls, content.seats].every(Array.isArray)) throw new Error();
    } catch {
      this.notifier.warn('That file is not a plan exported from the planner.');
      return;
    }
    const ok = await this.confirm.confirm({
      title: 'Replace the plan?',
      message: `The plan of this hall is replaced by the one in “${file.name}”. Undo brings it back.`,
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (!ok) return;
    const zoneIds = new Map(content.zones.map((z) => [z.id, newId()] as const));
    const zone = (id: string | null) => (id ? (zoneIds.get(id) ?? null) : null);
    const next: PlanContent = {
      zones: content.zones.map((z) => ({ ...z, id: zoneIds.get(z.id)! })),
      stalls: content.stalls.map((s) => ({ ...s, id: newId(), zoneId: zone(s.zoneId) })),
      seats: content.seats.map((s) => ({ ...s, id: newId(), zoneId: zone(s.zoneId) })),
      objects: (content.objects ?? []).map((o) => ({ ...o, id: newId() })),
    };
    const ids = [...next.zones, ...next.stalls, ...next.seats, ...next.objects].map((i) => i.id);
    if (await this.store.change(next, ids, null)) {
      this.notifier.success(
        `Plan brought in: ${next.stalls.length.toLocaleString('en-IN')} booths, ${next.zones.length} zones.`,
      );
    }
  }

  // ---- drawings -----------------------------------------------------------------------------

  /** A drawing from a drawing tool; text starts as “Text”, to write in Properties. */
  protected async addObject(e: DrawObjectEvent): Promise<void> {
    const plan = this.store.plan();
    const object: PlanObject = {
      id: newId(),
      kind: e.kind,
      points: e.points.map(([x, y]) => [round(x), round(y)] as Point),
      text: e.kind === 'text' ? 'Text' : null,
      color: OBJECT_COLOR,
    };
    const ok = await this.store.change(
      { ...plan, objects: [...plan.objects, object] },
      [object.id],
      { kind: 'object', ids: [object.id] },
    );
    if (ok && e.kind === 'text') this.tool.set('select');
  }

  protected async patchObjects(patch: Partial<Pick<PlanObject, 'text' | 'color'>>): Promise<void> {
    const ids = new Set(this.store.selectedObjects().map((o) => o.id));
    if (!ids.size) return;
    const plan = this.store.plan();
    await this.store.change(
      { ...plan, objects: plan.objects.map((o) => (ids.has(o.id) ? { ...o, ...patch } : o)) },
      [...ids],
    );
  }

  // ---- drawing ------------------------------------------------------------------------------

  protected drawn(r: { x: number; y: number; width: number; height: number }): void {
    if (this.tool() === 'booth') void this.addBooth(r);
    else void this.addZone(rectRing(r));
  }

  protected zoneFromPolygon(points: Point[]): void {
    if (polygonArea(points) < 0.5) {
      this.notifier.warn('A zone needs some area: draw at least three corners apart.');
      return;
    }
    void this.addZone(points);
  }

  protected placeBooth(at: Point): void {
    void this.addBooth({ x: at[0] - 1.5, y: at[1] - 1.5, width: 3, height: 3 });
  }

  private async addZone(polygon: Point[]): Promise<boolean> {
    const plan = this.store.plan();
    const zone: PlanZone = {
      id: newId(),
      name: `Zone ${plan.zones.length + 1}`,
      color: ZONE_COLORS[plan.zones.length % ZONE_COLORS.length],
      polygon: polygon.map(([x, y]) => [round(x), round(y)] as Point),
    };
    // Stalls and seats already inside join the zone.
    const inside = (i: PlanStall | PlanSeat) => pointInRing(centre(stallRect(i)), zone.polygon);
    const next = {
      ...plan,
      zones: [...plan.zones, zone],
      stalls: plan.stalls.map((s) => (inside(s) ? { ...s, zoneId: zone.id } : s)),
      seats: plan.seats.map((s) => (inside(s) ? { ...s, zoneId: zone.id } : s)),
    };
    if (await this.store.change(next, [zone.id], { kind: 'zone', ids: [zone.id] })) {
      this.tool.set('select');
      return true;
    }
    return false;
  }

  private async addBooth(r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<boolean> {
    const plan = this.store.plan();
    const [number] = stallNumbers(plan.stalls, null, 'numbers', 1, '');
    const stall = this.newStall(r, number);
    return this.store.change({ ...plan, stalls: [...plan.stalls, stall] }, [stall.id], {
      kind: 'stall',
      ids: [stall.id],
    });
  }

  private newStall(
    r: { x: number; y: number; width: number; height: number },
    number: string,
  ): PlanStall {
    const rect = { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
    return {
      id: newId(),
      zoneId: zoneAt(centre(rect), this.store.plan().zones)?.id ?? null,
      islandNumber: null,
      stallNumber: number,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      depth: rect.height,
      openSides: [...DEFAULT_OPEN],
      scheme: 'shell',
      categoryIds: [],
      isPremium: false,
      isBlocked: false,
      isFnb: false,
      isBranding: false,
      isHorseshoe: false,
      isMarqueeAvailable: false,
      isRestrictedForOverseas: false,
      isActive: true,
      location: null,
      description: null,
    };
  }

  // ---- selection and moving -----------------------------------------------------------------

  protected picked(e: PickEvent | null): void {
    if (!e) {
      this.store.select(null);
      return;
    }
    const current = this.store.selection();
    if (e.additive && current?.kind === e.kind) {
      const ids = new Set(current.ids);
      for (const id of e.ids) if (!ids.delete(id)) ids.add(id);
      this.store.select({ kind: e.kind, ids: [...ids] });
    } else {
      this.store.select({ kind: e.kind, ids: e.ids });
    }
  }

  protected async moved(e: MoveEvent): Promise<void> {
    const plan = this.store.plan();
    const ids = new Set(e.ids);
    const shift = <T extends { x: number; y: number }>(i: T): T => ({
      ...i,
      x: round(i.x + e.dx),
      y: round(i.y + e.dy),
    });
    let next = plan;
    if (e.kind === 'zone') {
      next = {
        ...plan,
        zones: plan.zones.map((z) =>
          ids.has(z.id)
            ? {
                ...z,
                polygon: z.polygon.map(([x, y]) => [round(x + e.dx), round(y + e.dy)] as Point),
              }
            : z,
        ),
      };
    } else if (e.kind === 'stall') {
      next = {
        ...plan,
        stalls: plan.stalls.map((s) => (ids.has(s.id) ? this.rezone(shift(s)) : s)),
      };
    } else if (e.kind === 'object') {
      next = {
        ...plan,
        objects: plan.objects.map((o) =>
          ids.has(o.id)
            ? {
                ...o,
                points: o.points.map(([x, y]) => [round(x + e.dx), round(y + e.dy)] as Point),
              }
            : o,
        ),
      };
    } else {
      next = { ...plan, seats: plan.seats.map((s) => (ids.has(s.id) ? this.rezone(shift(s)) : s)) };
    }
    await this.store.change(next, e.ids);
  }

  /** The zone an item is in after it moved. */
  private rezone<T extends PlanStall | PlanSeat>(i: T): T {
    return { ...i, zoneId: zoneAt(centre(stallRect(i)), this.store.plan().zones)?.id ?? null };
  }

  // ---- modify -------------------------------------------------------------------------------

  /** Copies of the selected booths, beside them to the right, with the next free numbers. */
  protected async copySelection(): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const plan = this.store.plan();
    const box = ringBox(selected.flatMap((s) => rectRing(stallRect(s))));
    const dx = round(box.width + this.snapStep());
    const copies: PlanStall[] = [];
    for (const s of selected) {
      const [number] = stallNumbers([...plan.stalls, ...copies], s.islandNumber, 'numbers', 1, '');
      copies.push(this.rezone({ ...s, id: newId(), stallNumber: number, x: round(s.x + dx) }));
    }
    const ids = copies.map((c) => c.id);
    await this.store.change({ ...plan, stalls: [...plan.stalls, ...copies] }, ids, {
      kind: 'stall',
      ids,
    });
  }

  /** Turns each selected booth a quarter clockwise about its middle; open sides turn too. */
  protected async rotateSelection(): Promise<void> {
    const ids = new Set(this.store.selectedStalls().map((s) => s.id));
    if (!ids.size) return;
    const plan = this.store.plan();
    const next = {
      ...plan,
      stalls: plan.stalls.map((s) => {
        if (!ids.has(s.id)) return s;
        const [cx, cy] = centre(stallRect(s));
        return this.rezone({
          ...s,
          x: round(cx - s.depth / 2),
          y: round(cy - s.width / 2),
          width: s.depth,
          depth: s.width,
          openSides: s.openSides.map((side) => ROTATED[side]),
        });
      }),
    };
    await this.store.change(next, [...ids]);
  }

  /**
   * Mirrors the selected booths within the box around them: left to right (x, Mirror X) or top
   * to bottom (y, Mirror).
   */
  protected async mirrorSelection(axis: 'x' | 'y'): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const ids = new Set(selected.map((s) => s.id));
    const box = ringBox(selected.flatMap((s) => rectRing(stallRect(s))));
    const plan = this.store.plan();
    const next = {
      ...plan,
      stalls: plan.stalls.map((s) =>
        ids.has(s.id)
          ? this.rezone(
              this.mirrored(s, axis, axis === 'x' ? box.x * 2 + box.width : box.y * 2 + box.height),
            )
          : s,
      ),
    };
    await this.store.change(next, [...ids]);
  }

  /**
   * Copies of the selected booths mirrored across a drawn line. Booths stay square to the hall,
   * so the line counts as across or up and down, whichever it is closer to.
   */
  protected async mirrorAcross([a, b]: [Point, Point]): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const across = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    const plan = this.store.plan();
    const copies: PlanStall[] = [];
    for (const s of selected) {
      const flipped = across
        ? this.mirrored(s, 'y', a[1] + b[1])
        : this.mirrored(s, 'x', a[0] + b[0]);
      const [number] = stallNumbers([...plan.stalls, ...copies], s.islandNumber, 'numbers', 1, '');
      copies.push(this.rezone({ ...flipped, id: newId(), stallNumber: number }));
    }
    const ids = copies.map((c) => c.id);
    if (
      await this.store.change({ ...plan, stalls: [...plan.stalls, ...copies] }, ids, {
        kind: 'stall',
        ids,
      })
    ) {
      this.tool.set('select');
    }
  }

  /** A booth mirrored across the line where x (or y) is `twice / 2`. */
  private mirrored(s: PlanStall, axis: 'x' | 'y', twice: number): PlanStall {
    return axis === 'x'
      ? {
          ...s,
          x: round(twice - s.x - s.width),
          openSides: s.openSides.map((side) => MIRRORED[side]),
        }
      : {
          ...s,
          y: round(twice - s.y - s.depth),
          openSides: s.openSides.map((side) => FLIPPED[side]),
        };
  }

  /** Splits the selected booth in two halves across its longer side; the new half is numbered next. */
  protected async splitSelection(): Promise<void> {
    const [s] = this.store.selectedStalls();
    if (!s || this.store.selectedStalls().length !== 1) return;
    const plan = this.store.plan();
    const wide = s.width >= s.depth;
    const half = round((wide ? s.width : s.depth) / 2);
    const first: PlanStall = wide ? { ...s, width: half } : { ...s, depth: half };
    const [number] = stallNumbers(plan.stalls, s.islandNumber, 'numbers', 1, '');
    const second: PlanStall = this.rezone(
      wide
        ? {
            ...s,
            id: newId(),
            stallNumber: number,
            x: round(s.x + half),
            width: round(s.width - half),
          }
        : {
            ...s,
            id: newId(),
            stallNumber: number,
            y: round(s.y + half),
            depth: round(s.depth - half),
          },
    );
    await this.store.change(
      {
        ...plan,
        stalls: [...plan.stalls.map((x) => (x.id === s.id ? this.rezone(first) : x)), second],
      },
      [s.id, second.id],
      { kind: 'stall', ids: [s.id, second.id] },
    );
  }

  /**
   * Joins the selected booths into the first of them, when together they fill a rectangle
   * exactly; the others are removed.
   */
  protected async mergeSelection(): Promise<void> {
    const selected = this.store.selectedStalls();
    if (selected.length < 2) return;
    const box = ringBox(selected.flatMap((s) => rectRing(stallRect(s))));
    const area = selected.reduce((sum, s) => sum + s.width * s.depth, 0);
    if (Math.abs(area - box.width * box.height) > 0.01) {
      this.notifier.warn('Not merged: the booths must fill a rectangle together, with no gaps.');
      return;
    }
    const [keep] = selected;
    const gone = new Set(selected.slice(1).map((s) => s.id));
    const merged = this.rezone({
      ...keep,
      x: round(box.x),
      y: round(box.y),
      width: round(box.width),
      depth: round(box.height),
    });
    const plan = this.store.plan();
    await this.store.change(
      {
        ...plan,
        stalls: plan.stalls
          .filter((s) => !gone.has(s.id))
          .map((s) => (s.id === keep.id ? merged : s)),
      },
      [keep.id],
      { kind: 'stall', ids: [keep.id] },
    );
  }

  /** Booths side by side in a row, in the middle of the view or of the selected zone. */
  protected rowOfBooths(): void {
    const zone = this.store.selectedZone();
    const at = zone ? centre(ringBox(zone.polygon)) : (this.canvas()?.viewCentre() ?? [0, 0]);
    this.dialog
      .open<Rect[]>(RowDialogComponent, {
        data: { at, snapStep: this.snapStep() } satisfies RowData,
        width: 'min(460px, 94vw)',
      })
      .subscribe(async (boxes) => {
        if (!boxes?.length) return;
        const plan = this.store.plan();
        const numbers = stallNumbers(plan.stalls, null, 'numbers', boxes.length, '');
        const stalls = boxes.map((b, i) => this.newStall(b, numbers[i]));
        const ids = stalls.map((s) => s.id);
        await this.store.change({ ...plan, stalls: [...plan.stalls, ...stalls] }, ids, {
          kind: 'stall',
          ids,
        });
      });
  }

  /** Grows or shrinks each selected booth about its middle. */
  protected scaleSelection(): void {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    this.dialog
      .open<number>(ScaleDialogComponent, {
        data: { count: selected.length } satisfies ScaleData,
        width: 'min(380px, 94vw)',
      })
      .subscribe(async (factor) => {
        if (!factor || factor === 1) return;
        const ids = new Set(selected.map((s) => s.id));
        const step = this.snapStep();
        const plan = this.store.plan();
        const next = {
          ...plan,
          stalls: plan.stalls.map((s) => {
            if (!ids.has(s.id)) return s;
            const [cx, cy] = centre(stallRect(s));
            const width = Math.max(step, snap(s.width * factor, step));
            const depth = Math.max(step, snap(s.depth * factor, step));
            return this.rezone({
              ...s,
              x: round(cx - width / 2),
              y: round(cy - depth / 2),
              width,
              depth,
            });
          }),
        };
        await this.store.change(next, [...ids]);
      });
  }

  /** Makes a booth of the selected zone (its box) or drawn rectangle, which it replaces. */
  protected async toBooth(): Promise<void> {
    const zone = this.store.selectedZone();
    const [object] = this.store.selectedObjects();
    const ring = zone
      ? zone.polygon
      : object?.kind === 'rect'
        ? objectOutline(object).points
        : null;
    if (!ring) return;
    const box = ringBox(ring);
    if (zone && Math.abs(polygonArea(zone.polygon) - box.width * box.height) > 0.01) {
      this.notifier.warn('Only a rectangular zone can become a booth.');
      return;
    }
    const plan = this.store.plan();
    const [number] = stallNumbers(plan.stalls, null, 'numbers', 1, '');
    const out = <T extends PlanStall | PlanSeat>(i: T): T =>
      zone && i.zoneId === zone.id ? { ...i, zoneId: null } : i;
    const rest = {
      ...plan,
      zones: zone ? plan.zones.filter((z) => z.id !== zone.id) : plan.zones,
      stalls: plan.stalls.map(out),
      seats: plan.seats.map(out),
      objects: object ? plan.objects.filter((o) => o.id !== object.id) : plan.objects,
    };
    const stall = {
      ...this.newStall(box, number),
      zoneId: zoneAt(centre(box), rest.zones)?.id ?? null,
    };
    await this.store.change({ ...rest, stalls: [...rest.stalls, stall] }, [stall.id], {
      kind: 'stall',
      ids: [stall.id],
    });
  }

  /**
   * Numbers the selected booths from 1 under their island, row by row from the top-left,
   * skipping numbers other booths of the island have.
   */
  protected async numberSelection(): Promise<void> {
    const selected = this.store.selectedStalls();
    if (!selected.length) return;
    const ids = new Set(selected.map((s) => s.id));
    const plan = this.store.plan();
    const others = plan.stalls.filter((s) => !ids.has(s.id));
    const ordered = [...selected].sort((a, b) => round(a.y, 0.1) - round(b.y, 0.1) || a.x - b.x);
    const byIsland = new Map<string, PlanStall[]>();
    for (const s of ordered) {
      const key = s.islandNumber ?? '';
      byIsland.set(key, [...(byIsland.get(key) ?? []), s]);
    }
    const numbers = new Map<string, string>();
    for (const [island, stalls] of byIsland) {
      const next = stallNumbers(others, island || null, 'numbers', stalls.length, '1');
      stalls.forEach((s, i) => numbers.set(s.id, next[i]));
    }
    await this.store.change(
      {
        ...plan,
        stalls: plan.stalls.map((s) =>
          numbers.has(s.id) ? { ...s, stallNumber: numbers.get(s.id)! } : s,
        ),
      },
      [...ids],
    );
  }

  // ---- properties ---------------------------------------------------------------------------

  protected async patchStalls(patch: StallPatch): Promise<void> {
    const plan = this.store.plan();
    const ids = new Set(this.store.selectedStalls().map((s) => s.id));
    if (!ids.size) return;
    const next = {
      ...plan,
      stalls: plan.stalls.map((s) => {
        if (!ids.has(s.id)) return s;
        const changed = { ...s, ...patch };
        return 'x' in patch || 'y' in patch || 'width' in patch || 'depth' in patch
          ? this.rezone(changed)
          : changed;
      }),
    };
    await this.store.change(next, [...ids]);
  }

  protected async patchZone(patch: Partial<Omit<PlanZone, 'id'>>): Promise<void> {
    const zone = this.store.selectedZone();
    if (!zone) return;
    const plan = this.store.plan();
    await this.store.change(
      { ...plan, zones: plan.zones.map((z) => (z.id === zone.id ? { ...z, ...patch } : z)) },
      [zone.id],
    );
  }

  protected async seatCategory(categoryId: string | null): Promise<void> {
    const plan = this.store.plan();
    const ids = new Set(this.store.selectedSeats().map((s) => s.id));
    await this.store.change(
      { ...plan, seats: plan.seats.map((s) => (ids.has(s.id) ? { ...s, categoryId } : s)) },
      [...ids],
    );
  }

  protected removeSelection(): void {
    const sel = this.store.selection();
    if (!sel || !this.canEdit()) return;
    const plan = this.store.plan();
    const ids = new Set(sel.ids);
    if (sel.kind === 'zone') {
      const zone = plan.zones.find((z) => ids.has(z.id));
      if (zone) this.removeZone(zone);
      return;
    }
    this.store.remove({
      ...plan,
      stalls: sel.kind === 'stall' ? plan.stalls.filter((s) => !ids.has(s.id)) : plan.stalls,
      seats: sel.kind === 'seat' ? plan.seats.filter((s) => !ids.has(s.id)) : plan.seats,
      objects: sel.kind === 'object' ? plan.objects.filter((o) => !ids.has(o.id)) : plan.objects,
    });
  }

  /** Deletes a zone; its stalls and seats stay, in no zone. */
  protected removeZone(zone: PlanZone): void {
    const plan = this.store.plan();
    const out = <T extends PlanStall | PlanSeat>(i: T): T =>
      i.zoneId === zone.id ? { ...i, zoneId: null } : i;
    this.store.remove({
      ...plan,
      zones: plan.zones.filter((z) => z.id !== zone.id),
      stalls: plan.stalls.map(out),
      seats: plan.seats.map(out),
    });
  }

  // ---- dialogs ------------------------------------------------------------------------------

  /** The hall and each zone, to fill; the selected zone first chosen. */
  private regions(): { regions: FillRegion[]; regionId: string } {
    const v = this.store.view()!;
    const floor = this.store.floor()!;
    const hallRing =
      floor.floor[0]?.[0] ??
      rectRing({ x: 0, y: 0, width: v.hall.floor.width, height: v.hall.floor.depth });
    const regions: FillRegion[] = [
      {
        id: 'hall',
        label: `The whole hall (${Math.round(polygonArea(hallRing))} m²)`,
        name: 'the whole hall',
        ring: hallRing,
      },
      ...this.store.plan().zones.map((z) => ({
        id: z.id,
        label: `Zone: ${z.name} (${Math.round(polygonArea(z.polygon))} m²)`,
        name: `zone “${z.name}”`,
        ring: z.polygon,
      })),
    ];
    const selected = this.store.selectedZone()?.id;
    const only = this.store.plan().zones.length === 1 ? this.store.plan().zones[0].id : undefined;
    return { regions, regionId: selected ?? only ?? 'hall' };
  }

  protected autoBooths(): void {
    const v = this.store.view();
    if (!v) return;
    const passage = v.hall.rules.values.passageWidth[v.hall.event.audience];
    this.dialog
      .open<PlanStall[]>(AutoBoothsDialogComponent, {
        data: { store: this.store, passage, ...this.regions() } satisfies AutoBoothsData,
        width: 'min(1080px, 96vw)',
      })
      .subscribe((stalls) => {
        if (stalls?.length) void this.addMany({ stalls }, 'booth');
      });
  }

  protected seats(): void {
    const zone = this.store.selectedZone();
    const at = zone ? centre(ringBox(zone.polygon)) : (this.canvas()?.viewCentre() ?? [0, 0]);
    this.dialog
      .open<PlanSeat[]>(SeatsDialogComponent, {
        data: { store: this.store, at, snapStep: this.snapStep() } satisfies SeatsData,
        width: 'min(460px, 94vw)',
      })
      .subscribe(async (seats) => {
        if (!seats?.length) return;
        const plan = this.store.plan();
        const ok = await this.store.change(
          { ...plan, seats: [...plan.seats, ...seats] },
          seats.map((s) => s.id),
          { kind: 'seat', ids: seats.map((s) => s.id) },
        );
        if (ok) this.tool.set('select');
      });
  }

  protected autoSeats(): void {
    this.dialog
      .open<PlanSeat[]>(AutoSeatsDialogComponent, {
        data: { store: this.store, ...this.regions() } satisfies AutoSeatsData,
        width: 'min(820px, 96vw)',
      })
      .subscribe((seats) => {
        if (seats?.length) void this.addMany({ seats }, 'seat');
      });
  }

  private async addMany(
    add: { stalls?: PlanStall[]; seats?: PlanSeat[] },
    what: 'booth' | 'seat',
  ): Promise<void> {
    const result = await this.store.addPassing(add);
    if (!result) return;
    const name = (n: number) => `${n.toLocaleString('en-IN')} ${what}${n === 1 ? '' : 's'}`;
    if (result.dropped) {
      this.notifier.warn(
        `${name(result.added)} added; ${name(result.dropped)} left out because they break a rule.`,
      );
    } else {
      this.notifier.success(`${name(result.added)} added.`);
    }
  }

  /** What Publish does now, or why it cannot. */
  protected readonly publishTip = computed(() => {
    const p = this.store.published();
    if (this.store.dirty()) return 'Save your changes first: the saved plan is what is published';
    if (!this.store.revision()) return 'Save the plan first';
    if (this.store.upToDate()) return `Version ${p!.revision} is published`;
    return p
      ? `Publish version ${this.store.revision()} (version ${p.revision} is published now)`
      : `Publish version ${this.store.revision()}; the rules are checked once more`;
  });

  protected async publish(): Promise<void> {
    const p = this.store.published();
    const ok = await this.confirm.confirm({
      title: 'Publish the stall plan?',
      message: p
        ? `Version ${this.store.revision()} replaces version ${p.revision} as the published plan of this hall.`
        : `Version ${this.store.revision()} becomes the published plan of this hall. You can keep drawing and publish again later.`,
      confirmLabel: 'Publish',
    });
    if (ok) await this.store.publish();
  }

  // ---- guided tour --------------------------------------------------------------------------

  /** Help: the tour for organisers; for the venue's team, the help card. */
  protected help(): void {
    if (this.tourFor()) this.startTour();
    else this.tourOpen.set(!this.tourOpen());
  }

  /**
   * Runs the guided tour. What the tour makes is what was not on the plan when it started; the
   * last step offers to remove it, which also leaves the plan unsaved-free if it was before.
   */
  protected startTour(): void {
    if (this.tour.active() || !this.store.view()) return;
    const start = this.store.plan();
    const startDirty = this.store.dirty();
    const known = new Set(
      [...start.zones, ...start.stalls, ...start.seats, ...start.objects].map((i) => i.id),
    );
    const fresh = <T extends { id: string }>(list: T[]) => list.filter((i) => !known.has(i.id));
    const ctx: PlannerTourCtx = {
      store: this.store,
      tool: this.tool,
      setTool: (tool) => this.setTool(tool),
      is3d: () => this.canvas()?.is3d() ?? false,
      enter3d: () => this.canvas()?.enter3d(),
      leave3d: () => this.canvas()?.leave3d(),
      openPlanPanel: () => this.leftOpen.set(true),
      openProperties: () => this.rightOpen.set(true),
      madeStalls: () => fresh(this.store.plan().stalls),
      madeZones: () => fresh(this.store.plan().zones),
      memo: {},
    };
    this.tourOpen.set(false);
    this.tour.start(plannerTour(this.canEdit()), ctx, {
      onEnd: (reason) => {
        this.tourSeen(reason === 'skip');
        this.tourOpen.set(true);
        this.tool.set('select');
      },
      made: () => {
        const p = this.store.plan();
        const parts = [
          [fresh(p.stalls).length, 'booth'],
          [fresh(p.zones).length, 'zone'],
          [fresh(p.seats).length, 'seat'],
          [fresh(p.objects).length, 'drawing'],
        ] as const;
        const text = parts
          .filter(([n]) => n)
          .map(([n, what]) => `${n} ${what}${n === 1 ? '' : 's'}`)
          .join(', ');
        return text || null;
      },
      removeMade: () => {
        const p = this.store.plan();
        const out = <T extends { id: string; zoneId: string | null }>(i: T): T =>
          i.zoneId && !known.has(i.zoneId) ? { ...i, zoneId: null } : i;
        this.store.remove({
          zones: p.zones.filter((z) => known.has(z.id)),
          stalls: p.stalls.filter((s) => known.has(s.id)).map(out),
          seats: p.seats.filter((s) => known.has(s.id)).map(out),
          objects: p.objects.filter((o) => known.has(o.id)),
        });
        // Back to the plan as it was: nothing new to save.
        if (!startDirty && JSON.stringify(this.store.plan()) === JSON.stringify(start)) {
          this.store.dirty.set(false);
        }
      },
    });
  }

  // ---- AI assistant -------------------------------------------------------------------------

  /** What the AI assistant reads and does: the store and the same handlers as the buttons. */
  protected readonly agentCtx: PlannerAgentCtx = {
    store: this.store,
    canvas: () => this.canvas(),
    passage: () => {
      const v = this.store.view();
      return v ? v.hall.rules.values.passageWidth[v.hall.event.audience] : 3;
    },
    confirm: (title, message, confirmLabel, destructive = false) =>
      this.confirm.confirm({ title, message, confirmLabel, destructive }),
    copySelection: () => this.copySelection(),
    rotateSelection: () => this.rotateSelection(),
    mirrorSelection: (axis) => this.mirrorSelection(axis),
    numberSelection: () => this.numberSelection(),
    splitSelection: () => this.splitSelection(),
    mergeSelection: () => this.mergeSelection(),
    patchStalls: (patch) => this.patchStalls(patch),
    patchZone: (patch) => this.patchZone(patch),
    moveSelection: (dx, dy) => {
      const sel = this.store.selection();
      return sel ? this.moved({ kind: sel.kind, ids: sel.ids, dx, dy }) : Promise.resolve();
    },
    removeSelection: () => this.removeSelection(),
    removeZone: (zone) => this.removeZone(zone),
    addZone: (polygon) => this.addZone(polygon),
    addBooth: (r) => this.addBooth(r),
    exportPlan: () => this.exportPlan(),
    fullDemo: () => this.fullDemo(),
    openProperties: () => this.rightOpen.set(true),
  };

  // ---- full demo ----------------------------------------------------------------------------

  /**
   * Why the full demo cannot start here, or null. It makes a venue hall, imports a drawing into
   * it and adds it to the event, so it needs those permissions as well as editing the plan.
   */
  protected readonly demoBlocker = computed(() => {
    if (!this.canEdit()) return 'The full demo needs a plan you may edit.';
    const can = (p: string) => this.context.can(p);
    if (!can('venues.manage') || !can('halls.import') || !can('events.manage')) {
      return "The full demo makes a new hall in the venue: ask the venue's admin to run it.";
    }
    if (this.tour.active()) return 'Finish the guided tour first.';
    return null;
  });

  /**
   * Asks how to run the full demo, then runs it in a new hall. This hall's unsaved changes are
   * never dropped for it: they are saved, or undone, first.
   */
  protected fullDemo(): void {
    if (this.demoBlocker() || this.demo.active()) return;
    if (this.store.dirty()) {
      this.notifier.warn(
        'Save or undo your changes first: the demo opens a new hall, and this one stays as it is.',
      );
      return;
    }
    this.dialog
      .open<DemoConfig>(FullDemoDialogComponent, { width: 'min(560px, 96vw)' })
      .subscribe((config) => {
        if (!config || this.store.dirty()) return;
        this.tourOpen.set(false);
        this.tool.set('select');
        this.demo.start(
          {
            store: this.store,
            canvas: () => this.canvas(),
            slug: this.slug(),
            eventId: this.eventId(),
            hallId: this.hallId(),
            openHall: (hallId) =>
              this.router.navigate(['/', this.slug(), 'events', this.eventId(), 'halls', hallId, 'planner']),
            openProperties: () => this.rightOpen.set(true),
          },
          config,
        );
      });
  }

  private tourKeys(): { seen: string; off: string } | null {
    const user = this.auth.user()?.id;
    return user
      ? { seen: `vpTourSeen:${user}:stall-planner:${this.slug()}`, off: `vpTourAutoOff:${user}` }
      : null;
  }

  /** Remembers the tour was seen here; "Skip the tour" also stops it opening by itself. */
  private tourSeen(off: boolean): void {
    const keys = this.tourKeys();
    if (!keys) return;
    try {
      localStorage.setItem(keys.seen, '1');
      if (off) localStorage.setItem(keys.off, '1');
    } catch {
      // Storage refused: the tour may open again next time.
    }
  }

  /** Opens the tour by itself the first time an organiser opens a planner. */
  private autoTour(): void {
    const keys = this.tourKeys();
    if (!this.tourFor() || !this.canEdit() || !keys || this.demo.active()) return;
    try {
      if (localStorage.getItem(keys.seen) || localStorage.getItem(keys.off)) return;
    } catch {
      return;
    }
    setTimeout(() => this.startTour(), 400);
  }

  protected async save(): Promise<void> {
    if (!this.store.dirty() || this.store.busy()) return;
    await this.store.save();
  }
}
