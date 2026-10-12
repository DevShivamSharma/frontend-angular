import type { Signal } from '@angular/core';

import type { PlanStall, PlanZone } from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import type { TourStep } from '../../../shared/tour/tour.models';
import type { PlannerTool } from './planner-canvas.component';
import {
  centre,
  grow,
  onOpenFloor,
  overlaps,
  Rect,
  rectRing,
  ringBox,
  stallRect,
} from './planner-geometry';
import type { StallPatch } from './planner-properties.component';
import type { PlannerStore } from './planner.store';

/** What the planner's tour reads and does; the planner page provides it. */
export interface PlannerTourCtx {
  store: PlannerStore;
  tool: Signal<PlannerTool>;
  setTool(tool: PlannerTool): void;
  is3d(): boolean;
  enter3d(): void;
  leave3d(): void;
  openPlanPanel(): void;
  openProperties(): void;
  /** What the tour draws and changes, the way the toolbar and Properties do it. */
  addZone(polygon: Point[]): Promise<boolean>;
  addBooth(r: { x: number; y: number; width: number; height: number }): Promise<boolean>;
  patchStalls(patch: StallPatch): Promise<void>;
  copySelection(): Promise<void>;
  /** Booths and zones made since the tour started, oldest first. */
  madeStalls(): PlanStall[];
  madeZones(): PlanZone[];
  /** Counts a step keeps from when it began. */
  memo: Record<string, number>;
}

/** The booth the tour is about: the last one made in it. */
function tourBooth(ctx: PlannerTourCtx): PlanStall | null {
  const made = ctx.madeStalls();
  return made[made.length - 1] ?? null;
}

function selectTourBooth(ctx: PlannerTourCtx): boolean {
  const booth = tourBooth(ctx);
  if (!booth) return false;
  ctx.store.select({ kind: 'stall', ids: [booth.id] });
  return true;
}

/** Room the tour leaves round what it draws, so no rule of the hall refuses it. */
const CLEAR = 3;
const ZONE = { width: 12, height: 9 };
const BOOTH = 3;

/**
 * An empty spot for a `width` × `height` rectangle on the open floor, `clear` metres from walls,
 * blocked areas, pillars and what is drawn; the one nearest the middle of `near` (else of the
 * hall). Null when the hall has no such spot.
 */
function freeSpot(
  ctx: PlannerTourCtx,
  width: number,
  height: number,
  clear: number,
  near?: Rect,
): Rect | null {
  const floor = ctx.store.floor();
  if (!floor) return null;
  const plan = ctx.store.plan();
  const taken = [
    ...plan.stalls.map(stallRect),
    ...plan.seats.map(stallRect),
    ...plan.zones.map((z) => ringBox(z.polygon)),
    ...floor.pillars,
  ];
  const boxes = floor.floor.map((poly) => ringBox(poly[0]));
  const [x0, y0] = [Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y))];
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const area = near ?? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const [cx, cy] = centre(area);
  let best: Rect | null = null;
  let bestDistance = Infinity;
  for (let y = Math.ceil(area.y); y + height <= area.y + area.height; y++) {
    for (let x = Math.ceil(area.x); x + width <= area.x + area.width; x++) {
      const r = { x, y, width, height };
      const distance = Math.hypot(x + width / 2 - cx, y + height / 2 - cy);
      if (distance >= bestDistance) continue;
      if (!onOpenFloor(grow(r, clear), floor)) continue;
      if (taken.some((t) => overlaps(r, t, clear))) continue;
      [best, bestDistance] = [r, distance];
    }
  }
  return best;
}

/** A booth in the middle of the tour's zone, else on an empty part of the floor. */
async function playBooth(ctx: PlannerTourCtx): Promise<void> {
  const zone = ctx.madeZones().at(-1);
  const box = zone && ringBox(zone.polygon);
  const middle = box && {
    x: Math.round(box.x + box.width / 2 - BOOTH / 2),
    y: Math.round(box.y + box.height / 2 - BOOTH / 2),
    width: BOOTH,
    height: BOOTH,
  };
  for (const spot of [middle, freeSpot(ctx, BOOTH, BOOTH, CLEAR)]) {
    if (spot && (await ctx.addBooth(spot))) return;
  }
}

/**
 * A booth half over the hall's wall, which the boundary rule refuses; if the hall lets it stand
 * (that rule is off), it is taken back at once.
 */
async function playRefusedBooth(ctx: PlannerTourCtx): Promise<void> {
  const floor = ctx.store.floor();
  if (!floor) return;
  const box = ringBox(floor.floor[0][0]);
  const made = await ctx.addBooth({
    x: box.x - BOOTH / 2,
    y: Math.round(box.y + box.height / 2),
    width: BOOTH,
    height: BOOTH,
  });
  if (made) ctx.store.undo();
}

/** Who takes the tour, and what the hall has: the steps follow them. */
export interface PlannerTourOptions {
  canEdit: boolean;
  /** The organiser admin publishes; an architect draws and saves. */
  canPublish: boolean;
  /** An external event: the venue approves the saved plan before the organiser publishes it. */
  needsApproval: boolean;
  /** The hall sells categories a booth can be given. */
  hasCategories: boolean;
  /** Some rule of the hall is on, so the tour can show one refusing a booth. */
  hasRules: boolean;
}

/**
 * The stall planner's tour, for the organiser's admin and architect: the plan panel, a zone, a
 * booth and a rule at work, its category and open sides, copy and undo, 3D, then what fills and
 * changes many at once, and saving. Read-only members get the info steps only.
 */
export function plannerTour(options: PlannerTourOptions): TourStep<PlannerTourCtx>[] {
  const { canEdit, canPublish, needsApproval, hasCategories, hasRules } = options;
  const steps: TourStep<PlannerTourCtx>[] = [
    {
      id: 'welcome',
      title: 'Welcome — let’s plan your stalls together',
      body: [
        'This is where your hall’s stall plan is made: the zones, the booths exhibitors choose from, and the seats.',
        'The tour plays by itself: it lights up one thing at a time, explains it and does it for you. Watch; Skip the tour stops it at any time.',
        'What the tour makes can be removed at the end. Nothing is saved until you press Save.',
      ],
    },
    {
      id: 'plan-panel',
      target: '[data-tour="plan-panel"]',
      before: (ctx) => ctx.openPlanPanel(),
      title: 'Your hall at a glance',
      body: [
        'The Plan panel shows the hall you are planning, the booths and area it sells, its zones, every booth in the model tree, and the categories this hall sells.',
        'The venue set this hall’s rules. Every change you make is checked against them; a change that breaks one is not made, and a message says why.',
      ],
    },
    {
      id: 'zone-tool',
      target: '[data-tour="zone-tool"]',
      title: 'Pick the Zone tool',
      shortcut: 'Z',
      body: [
        'A zone marks a part of the hall — a pavilion, a food court — so booths can be filled into it.',
      ],
      action: {
        prompt: 'Zone is picked in the toolbar (the key is Z).',
        play: (ctx) => ctx.setTool('zone-rect'),
        done: (ctx) => ctx.tool() === 'zone-rect',
      },
    },
    {
      id: 'draw-zone',
      target: '[data-tour="canvas"]',
      before: (ctx) => {
        ctx.memo['zones'] = ctx.madeZones().length;
        if (ctx.tool() !== 'zone-rect') ctx.setTool('zone-rect');
      },
      title: 'Draw a zone',
      body: [
        'Press on the floor at one corner, drag to the opposite corner and let go. The length, breadth and area show as you drag; a drag part-way into a grid square takes the whole square.',
      ],
      action: {
        prompt: 'A zone is drawn on an empty part of the floor.',
        play: async (ctx) => {
          const spot = freeSpot(ctx, ZONE.width, ZONE.height, CLEAR);
          if (spot) await ctx.addZone(rectRing(spot));
        },
        done: (ctx) => ctx.madeZones().length > (ctx.memo['zones'] ?? 0),
      },
    },
    {
      id: 'booth-tool',
      target: '[data-tour="booth-tool"]',
      title: 'Pick the Booth tool',
      shortcut: 'B',
      body: ['Booths are what exhibitors book. The Booth tool draws one.'],
      action: {
        prompt: 'Booth is picked in the toolbar (the key is B).',
        play: (ctx) => ctx.setTool('booth'),
        done: (ctx) => ctx.tool() === 'booth',
      },
    },
    {
      id: 'draw-booth',
      target: '[data-tour="canvas"]',
      before: (ctx) => {
        ctx.memo['stalls'] = ctx.madeStalls().length;
        if (ctx.tool() !== 'booth') ctx.setTool('booth');
      },
      title: 'Draw a booth',
      body: [
        'Drag on the floor for a booth of any size, or click once for a 3 × 3 m booth.',
        'A booth that breaks a rule of the hall — on a passage, against a wall, facing the closed side of another booth — is not made, and a message says why.',
      ],
      action: {
        prompt: 'A 3 × 3 m booth is drawn in the zone.',
        play: playBooth,
        done: (ctx) => ctx.madeStalls().length > (ctx.memo['stalls'] ?? 0),
      },
    },
    {
      id: 'rule',
      target: '[data-tour="canvas"]',
      before: (ctx) => {
        ctx.memo['refused'] = ctx.store.refused();
        if (ctx.tool() !== 'booth') ctx.setTool('booth');
      },
      title: 'See a rule at work',
      body: [
        'Every booth is checked against this hall’s rules the moment you make it. One that breaks a rule is not made, and a message says which rule — it is the hall’s rule, not a mistake.',
      ],
      action: {
        prompt: 'A booth is put where it cannot go: half over the hall’s wall.',
        play: playRefusedBooth,
        done: (ctx) => ctx.store.refused() > (ctx.memo['refused'] ?? 0),
      },
    },
    {
      id: 'select-tool',
      target: '[data-tour="select-tool"]',
      title: 'Back to Select',
      shortcut: 'V',
      body: [
        'Select is the everyday tool: it picks booths, moves them by dragging, and box-selects many.',
      ],
      action: {
        prompt: 'Select is picked (the key is V).',
        play: (ctx) => ctx.setTool('select'),
        done: (ctx) => ctx.tool() === 'select',
      },
    },
    {
      id: 'select-booth',
      target: '[data-tour="canvas"]',
      title: 'Select your booth',
      body: [
        'A selected booth shows its size on the plan, and its details open in Properties. Drag it to move it.',
      ],
      action: {
        prompt: 'The booth just drawn is clicked.',
        play: (ctx) => void selectTourBooth(ctx),
        done: (ctx) => {
          const booth = tourBooth(ctx);
          const sel = ctx.store.selection();
          return !!booth && sel?.kind === 'stall' && sel.ids.includes(booth.id);
        },
      },
    },
    hasCategories
      ? {
          id: 'category',
          target: '[data-tour="stall-categories"]',
          before: (ctx) => {
            ctx.openProperties();
            selectTourBooth(ctx);
          },
          title: 'Give it a category',
          body: [
            'Properties holds the selected booth’s number, size, open sides, flags and categories.',
            'The category is what the booth is sold as. Only the categories the venue chose for this hall are offered.',
          ],
          action: {
            prompt: 'A category is chosen in the Categories box.',
            play: async (ctx) => {
              const category = ctx.store.categories().find((c) => c.status === 'active');
              if (category && selectTourBooth(ctx))
                await ctx.patchStalls({ categoryIds: [category.id] });
            },
            done: (ctx) => (tourBooth(ctx)?.categoryIds.length ?? 0) > 0,
          },
        }
      : {
          id: 'category',
          target: '[data-tour="stall-categories"]',
          before: (ctx) => {
            ctx.openProperties();
            selectTourBooth(ctx);
          },
          title: 'Categories come from the venue',
          body: [
            'Properties holds the selected booth’s number, size, open sides, flags and categories.',
            'This hall sells no categories yet: the venue’s admin chooses them for the hall. Ask them; then give each booth its category here.',
          ],
        },
    // 2. open sides: what faces the aisle
    {
      id: 'open-sides',
      target: '[data-tour="open-sides"]',
      before: (ctx) => {
        ctx.openProperties();
        selectTourBooth(ctx);
        ctx.memo['sides'] = tourBooth(ctx)?.openSides.length ?? 0;
      },
      title: 'Open a side',
      body: [
        'A booth’s open sides face the visitors. Each open side needs the passage width clear in front of it, and it may not face the closed side of another booth; the rules check both.',
      ],
      action: {
        prompt: 'Another side is opened too.',
        play: async (ctx) => {
          const booth = tourBooth(ctx);
          const side = (['right', 'left', 'top', 'bottom'] as const).find(
            (s) => !booth?.openSides.includes(s),
          );
          if (booth && side && selectTourBooth(ctx)) {
            await ctx.patchStalls({ openSides: [...booth.openSides, side] });
          }
        },
        done: (ctx) => (tourBooth(ctx)?.openSides.length ?? 0) !== (ctx.memo['sides'] ?? 0),
      },
    },
    {
      id: 'copy',
      target: '[data-tour="copy"]',
      before: (ctx) => {
        selectTourBooth(ctx);
        ctx.memo['copies'] = ctx.madeStalls().length;
      },
      title: 'Copy it',
      shortcut: 'Ctrl + D',
      body: [
        'Copy puts a second booth beside the first, numbered on — the quickest way to make a row by hand. Split, Merge, Rotate, Mirror, Row and Number sit beside it.',
      ],
      action: {
        prompt: 'With the booth selected, Copy is clicked (or Ctrl + D).',
        play: async (ctx) => {
          if (selectTourBooth(ctx)) await ctx.copySelection();
        },
        done: (ctx) => ctx.madeStalls().length > (ctx.memo['copies'] ?? 0),
      },
    },
    {
      id: 'undo',
      target: '[data-tour="undo"]',
      before: (ctx) => {
        ctx.memo['beforeUndo'] = ctx.madeStalls().length;
      },
      title: 'Undo it',
      shortcut: 'Ctrl + Z',
      body: [
        'Every change is one step Undo takes back — a copy, a category, a whole auto-fill. Redo puts it back.',
      ],
      action: {
        prompt: 'Undo is clicked (or Ctrl + Z), and the copy goes.',
        play: (ctx) => ctx.store.undo(),
        done: (ctx) => ctx.madeStalls().length < (ctx.memo['beforeUndo'] ?? 0),
      },
    },
    {
      id: 'three-d',
      target: '[data-tour="view-switch"]',
      title: 'See it in 3D',
      shortcut: '3',
      body: [
        '3D shows the hall with its walls and pillars standing up and your booths with their shell walls. You can draw booths in 3D too.',
      ],
      action: {
        prompt: '3D is clicked (the key is 3).',
        play: (ctx) => ctx.enter3d(),
        done: (ctx) => ctx.is3d(),
      },
    },
    {
      id: 'back-to-2d',
      target: '[data-tour="cube-top"]',
      before: (ctx) => {
        if (!ctx.is3d()) ctx.enter3d();
      },
      title: 'Back to the plan',
      shortcut: '2',
      body: [
        'In 3D the view cube turns the hall: a side shows it from that side, and the wheel round it turns it. TOP brings back the 2D plan, where every tool works.',
      ],
      action: {
        prompt: 'TOP is clicked on the view cube (the key is 2).',
        play: (ctx) => ctx.leave3d(),
        done: (ctx) => !ctx.is3d(),
      },
    },
    {
      id: 'fill',
      target: '[data-tour="fill-group"]',
      title: 'Fill a hall in one go',
      body: [
        'Auto-booths fills a zone — or the whole hall — with booths of one size: aisles, numbering and categories, kept clear of pillars and of every rule. Rows open towards each other across the aisle.',
        'To booth turns a zone into a booth; Seats and Auto-seats lay out seating.',
      ],
    },
    {
      id: 'modify',
      target: '[data-tour="modify-group"]',
      title: 'Change many at once',
      body: [
        'Select booths (Shift-click, or drag a box on the floor), then Rotate, Mirror, Scale or Number them together. Merge joins booths that make a rectangle together; Split halves one.',
      ],
    },
    {
      id: 'measure',
      target: '[data-tour="measure-group"]',
      title: 'Measure and look',
      body: [
        'Measure distances, areas, angles and heights on the plan. View turns the grid and labels on and off, and Split view shows the plan twice.',
      ],
    },
    {
      id: 'save',
      target: '[data-tour="save-publish"]',
      title: canPublish ? 'Save, then publish' : 'Save your work',
      body: canPublish
        ? [
            'Save keeps the plan (Ctrl + S); Publish makes the saved plan the one that counts. Publish when the plan is ready — you can keep drawing and publish again.',
            'Not now — what you made in this tour is practice. Save when the plan is real.',
          ]
        : [
            needsApproval
              ? 'Save keeps the plan (Ctrl + S). Then send it for approval; once the venue approves it, you publish it.'
              : 'Save keeps the plan (Ctrl + S). Your Organiser Admin publishes it: tell them when it is ready.',
            'Not now — what you made in this tour is practice. Save when the plan is real.',
          ],
    },
    {
      id: 'done',
      title: 'You’re ready',
      body: [
        'Zone, Booth, Select, Properties, open sides, Copy, Undo and 3D — that is most of the daily work.',
        'Help in the toolbar and Help & guided tour in the corner of the plan play this tour again.',
      ],
    },
  ];
  const shown = hasRules ? steps : steps.filter((s) => s.id !== 'rule');
  return canEdit ? shown : shown.filter((s) => !s.action);
}
