import type { Signal } from '@angular/core';

import type { PlanStall, PlanZone } from '../../../core/plans/plans.models';
import type { TourStep } from '../../../shared/tour/tour.models';
import type { PlannerTool } from './planner-canvas.component';
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

/** Who takes the tour, and what the hall has: the steps follow them. */
export interface PlannerTourOptions {
  canEdit: boolean;
  /** The organiser admin publishes; an architect draws and saves. */
  canPublish: boolean;
  /** The hall sells categories a booth can be given. */
  hasCategories: boolean;
}

/**
 * The stall planner's tour, for the organiser's admin and architect: the plan panel, a zone, a
 * booth and a rule at work, its category and open sides, copy and undo, 3D, then what fills and
 * changes many at once, and saving. Read-only members get the info steps only.
 */
export function plannerTour(options: PlannerTourOptions): TourStep<PlannerTourCtx>[] {
  const { canEdit, canPublish, hasCategories } = options;
  const steps: TourStep<PlannerTourCtx>[] = [
    {
      id: 'welcome',
      title: 'Welcome — let’s plan your stalls together',
      body: [
        'This is where your hall’s stall plan is made: the zones, the booths exhibitors choose from, and the seats.',
        'The tour lights up one thing at a time and tells you what to do. Do it, and the tour moves on by itself. Stuck? Press Next to go on.',
        'Anything you make in the tour can be removed at the end. Nothing is saved until you press Save.',
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
        prompt: 'Click Zone in the toolbar (or press Z).',
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
        prompt: 'Drag a zone on an empty part of the floor.',
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
        prompt: 'Click Booth in the toolbar (or press B).',
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
        prompt: 'Draw one booth on an empty part of the floor.',
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
        prompt:
          'With Booth, click where a booth cannot go: on a red passage, or right against the hall’s wall.',
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
        prompt: 'Click Select (or press V).',
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
        prompt: 'Click the booth you just drew.',
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
            prompt: 'Choose a category in the Categories box.',
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
        prompt: 'Click another side — Right, say — to open it too.',
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
        prompt: 'With your booth selected, click Copy (or press Ctrl + D).',
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
        prompt: 'Click Undo (or press Ctrl + Z) to take the copy away.',
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
        prompt: 'Click 3D (or press 3).',
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
        prompt: 'Click TOP on the view cube (or press 2).',
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
            'Save keeps the plan (Ctrl + S). Your Organiser Admin publishes it: tell them when it is ready.',
            'Not now — what you made in this tour is practice. Save when the plan is real.',
          ],
    },
    {
      id: 'done',
      title: 'You’re ready',
      body: [
        'Zone, Booth, Select, Properties, open sides, Copy, Undo and 3D — that is most of the daily work.',
        'Help in the toolbar and Help & guided tour in the corner of the plan run this tour again.',
      ],
    },
  ];
  return canEdit ? steps : steps.filter((s) => !s.action);
}
