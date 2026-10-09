import type {
  PlanContent,
  PlanObject,
  PlanSeat,
  PlanStall,
  PlanZone,
  StallSide,
} from '../../../core/plans/plans.models';
import { stallLabel } from '../../../core/plans/plans.models';
import type { Point } from '../../../core/venues/floor-plan.models';
import type { PlannerCanvasComponent } from './planner-canvas.component';
import {
  centre,
  fillBooths,
  fillSeats,
  type Front,
  letters,
  newId,
  nextRow,
  polygonArea,
  type Rect,
  rectRing,
  ringBox,
  round,
  stallNumbers,
  stallRect,
  zoneAt,
  zoneGrid,
  ZONE_COLORS,
} from './planner-geometry';
import type { StallPatch } from './planner-properties.component';
import type { PlannerStore } from './planner.store';

/**
 * The tools of the planner's AI assistant, carried out here with the planner's own actions: the
 * same handlers its buttons call, so every change is checked against the hall's rules and can be
 * undone. The server decides which tools a member is offered; each tool still checks the plan
 * may be edited before it changes anything.
 */

/** What the assistant reads and does; the planner page provides it. */
export interface PlannerAgentCtx {
  store: PlannerStore;
  canvas: () => PlannerCanvasComponent | undefined;
  /** The hall's passage width, metres. */
  passage: () => number;
  /** Asks the person in a dialog; true when they agree. */
  confirm: (title: string, message: string, label: string, destructive?: boolean) => Promise<boolean>;
  /** The page's handlers; each acts on the store's selection, as its button does. */
  copySelection: () => Promise<void>;
  rotateSelection: () => Promise<void>;
  mirrorSelection: (axis: 'x' | 'y') => Promise<void>;
  numberSelection: () => Promise<void>;
  splitSelection: () => Promise<void>;
  mergeSelection: () => Promise<void>;
  patchStalls: (patch: StallPatch) => Promise<void>;
  patchZone: (patch: Partial<Omit<PlanZone, 'id'>>) => Promise<void>;
  moveSelection: (dx: number, dy: number) => Promise<void>;
  removeSelection: () => void;
  removeZone: (zone: PlanZone) => void;
  addZone: (polygon: Point[]) => Promise<boolean>;
  addBooth: (r: Rect) => Promise<boolean>;
  exportPlan: () => void;
  fullDemo: () => void;
  openProperties: () => void;
}

/** What a tool did: `ok`, a line for the chat, and the result the model reads. */
export interface ToolOutcome {
  ok: boolean;
  summary: string;
  result: unknown;
}

/** More than this many items changed at once asks the person first. */
const CONFIRM_OVER = 10;
const LIST_LIMIT = 30;
const TOUR_MS = 12_000;

type Args = Record<string, unknown>;

/** Runs one tool; an unknown tool or a refused change is an outcome, never an exception. */
export async function runTool(ctx: PlannerAgentCtx, name: string, args: Args): Promise<ToolOutcome> {
  const tool = TOOLS[name];
  if (!tool) return fail(`There is no tool “${name}”.`);
  if (tool.edits && !ctx.store.canEdit()) return fail('This plan is read-only for you.');
  try {
    return await tool.run(ctx, args);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The tool failed.');
  }
}

/** A short line naming a tool, for the chat while it runs. */
export function toolLabel(name: string): string {
  return TOOLS[name]?.label ?? name;
}

interface Tool {
  label: string;
  edits: boolean;
  run: (ctx: PlannerAgentCtx, args: Args) => Promise<ToolOutcome>;
}

const TOOLS: Record<string, Tool> = {
  // ---- seeing ----------------------------------------------------------------------------------
  get_plan_summary: {
    label: 'Reading the plan',
    edits: false,
    run: async (ctx) => ok('Read the plan', summary(ctx)),
  },
  find_booths: {
    label: 'Finding booths',
    edits: false,
    run: async (ctx, a) => {
      const booths = resolveBooths(ctx, a['booths']);
      const limit = clampInt(a['limit'], 1, 200, LIST_LIMIT);
      return ok(`Found ${booths.length} booths`, {
        count: booths.length,
        booths: booths.slice(0, limit).map((s) => boothFacts(ctx, s)),
        more: Math.max(0, booths.length - limit),
      });
    },
  },
  check_rules: {
    label: 'Checking the rules',
    edits: false,
    run: async (ctx) => {
      const plan = ctx.store.plan();
      const ids = [...plan.zones, ...plan.stalls, ...plan.seats].map((i) => i.id);
      const findings = await ctx.store.check(plan, ids);
      if (findings === null) return fail('The rules could not be checked just now.');
      return ok(findings.length ? `${findings.length} rule problems` : 'No rule is broken', {
        problems: findings.slice(0, 20).map((f) => ({ rule: f.message, items: f.ids.length })),
        more: Math.max(0, findings.length - 20),
      });
    },
  },
  show_3d: {
    label: 'Opening 3D',
    edits: false,
    run: async (ctx, a) => {
      const canvas = ctx.canvas();
      if (!canvas) return fail('The view is not ready.');
      ctx.store.select(null);
      const angle = num(a['angle']);
      canvas.enter3d(angle ?? undefined);
      if (angle !== null && canvas.is3d()) canvas.enter3d(angle);
      return ok('Showing the hall in 3D', { shown: '3d' });
    },
  },
  show_2d: {
    label: 'Back to 2D',
    edits: false,
    run: async (ctx) => {
      ctx.canvas()?.leave3d();
      ctx.canvas()?.fit();
      return ok('Back to the plan from above', { shown: '2d' });
    },
  },
  focus: {
    label: 'Zooming in',
    edits: false,
    run: async (ctx, a) => {
      const canvas = ctx.canvas();
      if (!canvas) return fail('The view is not ready.');
      if (str(a['zone'])) {
        const zone = findZone(ctx, str(a['zone'])!);
        ctx.store.select({ kind: 'zone', ids: [zone.id] });
        canvas.leave3d();
        canvas.zoomTo(ringBox(zone.polygon));
        return ok(`Showing ${zone.name}`, { zone: zone.name });
      }
      const booths = resolveBooths(ctx, a['booths']);
      if (!booths.length) return fail('No booth matches.');
      ctx.store.select({ kind: 'stall', ids: booths.map((s) => s.id) });
      canvas.leave3d();
      canvas.zoomTo(ringBox(booths.flatMap((s) => rectRing(stallRect(s)))));
      ctx.openProperties();
      return ok(`Showing ${booths.length} booths`, { booths: booths.length });
    },
  },
  camera_tour: {
    label: 'Camera tour',
    edits: false,
    run: async (ctx) => {
      const canvas = ctx.canvas();
      if (!canvas) return fail('The view is not ready.');
      ctx.store.select(null);
      await orbit(canvas);
      return ok('Took the camera round the hall', { done: true });
    },
  },
  export_plan: {
    label: 'Exporting the plan',
    edits: false,
    run: async (ctx) => {
      ctx.exportPlan();
      return ok('Downloaded the plan file', { downloaded: true });
    },
  },
  // ---- zones -----------------------------------------------------------------------------------
  auto_zones: {
    label: 'Making zones',
    edits: true,
    run: async (ctx, a) => {
      const store = ctx.store;
      if (store.plan().zones.length) {
        return fail('The plan already has zones; delete them first or add zones one by one.');
      }
      const floor = store.floor();
      if (!floor) return fail('The hall floor is not loaded.');
      const rects = zoneGrid(floor, num(a['aisle']) ?? ctx.passage());
      if (!rects.length) return fail('The floor has no room for zones with that aisle.');
      const zones: PlanZone[] = rects.map((r, i) => ({
        id: newId(),
        name: `Zone ${letters(i)}`,
        color: ZONE_COLORS[i % ZONE_COLORS.length],
        polygon: rectRing(r),
      }));
      const plan = store.plan();
      const ids = zones.map((z) => z.id);
      const done = await change(ctx, () =>
        store.change({ ...plan, zones: [...plan.zones, ...zones] }, ids, { kind: 'zone', ids }),
      );
      return done ?? ok(`Made ${zones.length} zones`, { zones: zones.map((z) => z.name) });
    },
  },
  add_zone: {
    label: 'Adding a zone',
    edits: true,
    run: async (ctx, a) => {
      const r = rectArg(a);
      const before = ctx.store.plan().zones.length;
      const done = await change(ctx, () => ctx.addZone(rectRing(r)));
      if (done) return done;
      const zone = ctx.store.plan().zones[before];
      const name = str(a['name']);
      if (zone && name) {
        ctx.store.select({ kind: 'zone', ids: [zone.id] });
        await ctx.patchZone({ name });
      }
      return ok(`Added ${name ?? zone?.name ?? 'a zone'}`, { zone: name ?? zone?.name });
    },
  },
  update_zone: {
    label: 'Changing a zone',
    edits: true,
    run: async (ctx, a) => {
      const zone = findZone(ctx, str(a['zone']) ?? '');
      const patch: Partial<Omit<PlanZone, 'id'>> = {};
      if (str(a['name'])) patch.name = str(a['name'])!;
      if (str(a['color']) && /^#[0-9a-f]{6}$/i.test(str(a['color'])!)) patch.color = str(a['color'])!;
      if (!Object.keys(patch).length) return fail('Say the new name or colour.');
      ctx.store.select({ kind: 'zone', ids: [zone.id] });
      const done = await change(ctx, () => ctx.patchZone(patch));
      return done ?? ok(`Changed ${zone.name}`, { zone: patch.name ?? zone.name });
    },
  },
  delete_zone: {
    label: 'Deleting a zone',
    edits: true,
    run: async (ctx, a) => {
      const zone = findZone(ctx, str(a['zone']) ?? '');
      ctx.removeZone(zone);
      return ok(`Deleted ${zone.name}; its booths stay`, { deleted: zone.name });
    },
  },
  // ---- booths ----------------------------------------------------------------------------------
  auto_booths: {
    label: 'Filling with booths',
    edits: true,
    run: async (ctx, a) => {
      const store = ctx.store;
      const width = positive(a['width']) ?? 3;
      const depth = positive(a['depth']) ?? 3;
      const aisle = positive(a['aisle']) ?? ctx.passage();
      const count = a['count'] === undefined ? null : clampInt(a['count'], 1, 3000, 3000);
      const regions = fillRegions(ctx, str(a['zone']));
      if (regions.some((r) => r.id === 'hall')) {
        const yes = await ctx.confirm(
          'Fill the whole hall with booths?',
          `The assistant wants to fill the whole hall with ${width} × ${depth} m booths. Undo takes them away.`,
          'Fill the hall',
        );
        if (!yes) return fail('The person said no.');
      }
      let added = 0;
      let dropped = 0;
      for (const region of regions) {
        const floor = store.floor();
        if (!floor) return fail('The hall floor is not loaded.');
        const plan = store.plan();
        const places = fillBooths(
          {
            region: region.ring,
            width,
            depth,
            aisle,
            margin: 0.5,
            count,
            pillarClearance: 0.5,
            shiftForPillars: true,
            sellPillarStands: false,
          },
          floor,
          plan.stalls,
          plan.seats,
        );
        if (!places.length) continue;
        const result = await store.addPassing({ stalls: booths(ctx, region.island, places) });
        if (result) {
          added += result.added;
          dropped += result.dropped;
        }
      }
      if (!added) {
        return fail(
          store.lastRefusal() ?? 'No booth of that size fits there under the hall’s rules.',
        );
      }
      return ok(`Added ${added} booths` + (dropped ? `, ${dropped} left out by rules` : ''), {
        added,
        leftOutByRules: dropped,
        regions: regions.map((r) => r.name),
      });
    },
  },
  add_booth: {
    label: 'Adding a booth',
    edits: true,
    run: async (ctx, a) => {
      const r = rectArg(a);
      const before = new Set(ctx.store.plan().stalls.map((s) => s.id));
      const done = await change(ctx, () => ctx.addBooth(r));
      if (done) return done;
      const made = ctx.store.plan().stalls.find((s) => !before.has(s.id));
      const island = str(a['island']);
      if (made && island) {
        ctx.store.select({ kind: 'stall', ids: [made.id] });
        await ctx.patchStalls({ islandNumber: island });
      }
      const booth = ctx.store.plan().stalls.find((s) => s.id === made?.id);
      return ok(`Added booth ${booth ? label(booth) : ''}`, { booth: booth ? label(booth) : null });
    },
  },
  update_booths: {
    label: 'Changing booths',
    edits: true,
    run: async (ctx, a) => {
      const targets = resolveBooths(ctx, a['booths']);
      if (!targets.length) return fail('No booth matches.');
      const patch = stallPatch(ctx, a);
      if (!Object.keys(patch).length) return fail('Say what to change.');
      if (targets.length > 200) {
        const yes = await ctx.confirm(
          `Change ${targets.length} booths?`,
          `The assistant wants to change ${describePatch(patch)} on ${targets.length} booths.`,
          'Change them',
        );
        if (!yes) return fail('The person said no.');
      }
      select(ctx, targets);
      ctx.openProperties();
      const done = await change(ctx, () => ctx.patchStalls(patch));
      return (
        done ??
        ok(`Changed ${targets.length} booths: ${describePatch(patch)}`, {
          changed: targets.length,
          labels: targets.slice(0, LIST_LIMIT).map(label),
        })
      );
    },
  },
  move_booths: {
    label: 'Moving booths',
    edits: true,
    run: async (ctx, a) => {
      const targets = resolveBooths(ctx, a['booths']);
      if (!targets.length) return fail('No booth matches.');
      const dx = num(a['dx']) ?? 0;
      const dy = num(a['dy']) ?? 0;
      select(ctx, targets);
      const done = await change(ctx, () => ctx.moveSelection(dx, dy));
      return done ?? ok(`Moved ${targets.length} booths`, { moved: targets.length, dx, dy });
    },
  },
  rotate_booths: selectionTool('Turning booths', 'Turned', (ctx) => ctx.rotateSelection()),
  mirror_booths: {
    label: 'Mirroring booths',
    edits: true,
    run: async (ctx, a) => {
      const axis = a['axis'] === 'y' ? 'y' : 'x';
      return selectionTool('Mirroring booths', 'Mirrored', (c) => c.mirrorSelection(axis)).run(
        ctx,
        a,
      );
    },
  },
  copy_booths: selectionTool('Copying booths', 'Copied', (ctx) => ctx.copySelection()),
  renumber_booths: selectionTool('Renumbering', 'Renumbered', (ctx) => ctx.numberSelection()),
  merge_booths: {
    label: 'Merging booths',
    edits: true,
    run: async (ctx, a) => {
      const targets = resolveBooths(ctx, a['booths']);
      if (targets.length < 2) return fail('Merging needs two booths or more.');
      select(ctx, targets);
      const count = ctx.store.plan().stalls.length;
      const done = await change(ctx, () => ctx.mergeSelection());
      if (done) return done;
      if (ctx.store.plan().stalls.length === count) {
        return fail('Not merged: the booths must fill a rectangle together, with no gaps.');
      }
      return ok(`Merged ${targets.length} booths into ${label(targets[0])}`, {
        booth: label(targets[0]),
      });
    },
  },
  split_booth: {
    label: 'Splitting a booth',
    edits: true,
    run: async (ctx, a) => {
      const [booth, ...more] = resolveBooths(ctx, { labels: [str(a['booth']) ?? ''] });
      if (!booth || more.length) return fail('Name exactly one booth to split.');
      select(ctx, [booth]);
      const done = await change(ctx, () => ctx.splitSelection());
      return done ?? ok(`Split booth ${label(booth)} in two`, { booth: label(booth) });
    },
  },
  delete_booths: {
    label: 'Deleting booths',
    edits: true,
    run: async (ctx, a) => {
      const targets = resolveBooths(ctx, a['booths']);
      if (!targets.length) return fail('No booth matches.');
      if (targets.length > CONFIRM_OVER) {
        const yes = await ctx.confirm(
          `Delete ${targets.length} booths?`,
          `The assistant wants to delete ${targets.length} booths. Undo brings them back.`,
          'Delete',
          true,
        );
        if (!yes) return fail('The person said no.');
      }
      select(ctx, targets);
      ctx.removeSelection();
      return ok(`Deleted ${targets.length} booths`, {
        deleted: targets.length,
        labels: targets.slice(0, LIST_LIMIT).map(label),
      });
    },
  },
  // ---- seats and drawings ----------------------------------------------------------------------
  auto_seats: {
    label: 'Adding seats',
    edits: true,
    run: async (ctx, a) => {
      const store = ctx.store;
      const floor = store.floor();
      if (!floor) return fail('The hall floor is not loaded.');
      const [region] = fillRegions(ctx, str(a['zone']) ?? 'hall');
      const front = (['top', 'bottom', 'left', 'right'] as const).includes(a['front'] as Front)
        ? (a['front'] as Front)
        : 'top';
      const plan = store.plan();
      const places = fillSeats(
        {
          region: region.ring,
          width: 0.5,
          depth: 0.5,
          gap: 0.1,
          rowGap: 0.9,
          aisleEvery: 10,
          aisleWidth: 1.2,
          front,
          most: clampInt(a['count'], 1, 5000, 5000),
          clearance: 0.3,
        },
        floor,
        plan.stalls,
        plan.seats,
      );
      if (!places.length) return fail(`No seat fits in ${region.name}.`);
      const category = str(a['category']) ? findCategory(ctx, str(a['category'])!) : null;
      const first = nextRow(plan.seats);
      const seats: PlanSeat[] = places.map((r) => ({
        id: newId(),
        zoneId: zoneAt(centre(r), plan.zones)?.id ?? null,
        rowLabel: letters(first + r.row),
        seatNumber: r.seat,
        x: r.x,
        y: r.y,
        width: r.width,
        depth: r.height,
        categoryId: category?.id ?? null,
      }));
      const result = await store.addPassing({ seats });
      if (!result) return fail(store.lastRefusal() ?? 'The seats break a rule of this hall.');
      return ok(`Added ${result.added} seats in ${region.name}`, {
        added: result.added,
        leftOutByRules: result.dropped,
      });
    },
  },
  delete_seats: {
    label: 'Deleting seats',
    edits: true,
    run: async (ctx, a) => {
      const plan = ctx.store.plan();
      const zone = str(a['zone']) ? findZone(ctx, str(a['zone'])!) : null;
      if (!zone && a['all'] !== true) return fail('Say which zone, or all seats.');
      const gone = plan.seats.filter((s) => !zone || s.zoneId === zone.id);
      if (!gone.length) return fail('There are no seats there.');
      if (gone.length > CONFIRM_OVER * 10) {
        const yes = await ctx.confirm(
          `Delete ${gone.length} seats?`,
          `The assistant wants to delete ${gone.length} seats. Undo brings them back.`,
          'Delete',
          true,
        );
        if (!yes) return fail('The person said no.');
      }
      const ids = new Set(gone.map((s) => s.id));
      ctx.store.remove({ ...plan, seats: plan.seats.filter((s) => !ids.has(s.id)) });
      return ok(`Deleted ${gone.length} seats`, { deleted: gone.length });
    },
  },
  add_label: {
    label: 'Writing a label',
    edits: true,
    run: async (ctx, a) => {
      const text = str(a['text']);
      const x = num(a['x']);
      const y = num(a['y']);
      if (!text || x === null || y === null) return fail('Give the text and where (x, y).');
      const plan = ctx.store.plan();
      const object: PlanObject = {
        id: newId(),
        kind: 'text',
        points: [[round(x), round(y)]],
        text: text.slice(0, 200),
        color: '#334155',
      };
      const done = await change(ctx, () =>
        ctx.store.change({ ...plan, objects: [...plan.objects, object] }, [object.id], {
          kind: 'object',
          ids: [object.id],
        }),
      );
      return done ?? ok(`Wrote “${object.text}”`, { label: object.text });
    },
  },
  // ---- the plan --------------------------------------------------------------------------------
  undo: {
    label: 'Undoing',
    edits: true,
    run: async (ctx, a) => {
      const steps = clampInt(a['steps'], 1, 20, 1);
      let n = 0;
      for (; n < steps && ctx.store.canUndo(); n++) ctx.store.undo();
      return n ? ok(`Undid ${n} step${n === 1 ? '' : 's'}`, { undone: n }) : fail('Nothing to undo.');
    },
  },
  redo: {
    label: 'Redoing',
    edits: true,
    run: async (ctx, a) => {
      const steps = clampInt(a['steps'], 1, 20, 1);
      let n = 0;
      for (; n < steps && ctx.store.canRedo(); n++) ctx.store.redo();
      return n ? ok(`Redid ${n} step${n === 1 ? '' : 's'}`, { redone: n }) : fail('Nothing to redo.');
    },
  },
  save: {
    label: 'Saving',
    edits: true,
    run: async (ctx) => {
      const store = ctx.store;
      if (!store.dirty()) return ok('Nothing new to save', { revision: store.revision() });
      if (!(await store.save())) return fail('The plan was not saved; the message on screen says why.');
      return ok(`Saved as version ${store.revision()}`, { revision: store.revision() });
    },
  },
  publish: {
    label: 'Publishing',
    edits: true,
    run: async (ctx) => {
      const store = ctx.store;
      if (!store.view()?.canPublish) return fail('You may not publish stall plans here.');
      if (store.dirty() || !store.revision()) return fail('Save the plan first: the saved plan is what is published.');
      if (store.upToDate()) return ok(`Version ${store.revision()} is already published`, {});
      const p = store.published();
      const yes = await ctx.confirm(
        'Publish the stall plan?',
        p
          ? `Version ${store.revision()} replaces version ${p.revision} as the published plan of this hall.`
          : `Version ${store.revision()} becomes the published plan of this hall.`,
        'Publish',
      );
      if (!yes) return fail('The person said no.');
      if (!(await store.publish())) return fail('Not published; the message on screen says why.');
      return ok(`Published version ${store.revision()}`, { published: store.revision() });
    },
  },
  run_full_demo: {
    label: 'Opening the full demo',
    edits: true,
    run: async (ctx) => {
      ctx.fullDemo();
      return ok('Opened the full demo setup', { opened: true });
    },
  },
};

// ---- helpers ------------------------------------------------------------------------------------

function ok(summary: string, result: unknown): ToolOutcome {
  return { ok: true, summary, result };
}

function fail(reason: string): ToolOutcome {
  return { ok: false, summary: reason, result: { error: reason } };
}

/**
 * Runs a change through the planner; null when the plan changed, or the refusal when it did not
 * (the hall's rule the toast named, if any).
 */
async function change(
  ctx: PlannerAgentCtx,
  act: () => Promise<unknown> | unknown,
): Promise<ToolOutcome | null> {
  const before = ctx.store.plan();
  ctx.store.lastRefusal.set(null);
  await act();
  if (ctx.store.plan() !== before) return null;
  return fail(ctx.store.lastRefusal() ?? 'Nothing changed.');
}

/** A tool that selects booths and runs one of the page's selection handlers. */
function selectionTool(
  toolLabel: string,
  done: string,
  act: (ctx: PlannerAgentCtx) => Promise<void>,
): Tool {
  return {
    label: toolLabel,
    edits: true,
    run: async (ctx, a) => {
      const targets = resolveBooths(ctx, a['booths']);
      if (!targets.length) return fail('No booth matches.');
      select(ctx, targets);
      const refused = await change(ctx, () => act(ctx));
      return (
        refused ??
        ok(`${done} ${targets.length} booths`, {
          booths: targets.length,
          labels: targets.slice(0, LIST_LIMIT).map(label),
        })
      );
    },
  };
}

function select(ctx: PlannerAgentCtx, booths: PlanStall[]): void {
  ctx.store.select({ kind: 'stall', ids: booths.map((s) => s.id) });
}

function label(s: PlanStall): string {
  return s.islandNumber ? `${s.islandNumber}-${s.stallNumber}` : s.stallNumber;
}

/** A label without separators, any case: "A-12", "a 12" and "A12" are one. */
function key(text: string): string {
  return text.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/** The booths a selector names; an empty selector is an error, never "every booth". */
function resolveBooths(ctx: PlannerAgentCtx, selector: unknown): PlanStall[] {
  const s = (selector && typeof selector === 'object' ? selector : {}) as Args;
  const plan = ctx.store.plan();
  const filters: Array<(b: PlanStall) => boolean> = [];
  const labels = Array.isArray(s['labels']) ? (s['labels'] as unknown[]).map(String) : [];
  if (labels.length) {
    const wanted = new Set(labels.map(key));
    filters.push((b) => wanted.has(key(stallLabel(b))));
  }
  if (str(s['zone'])) {
    const zone = findZone(ctx, str(s['zone'])!);
    filters.push((b) => b.zoneId === zone.id);
  }
  if (str(s['island'])) {
    const island = key(str(s['island'])!);
    filters.push((b) => key(b.islandNumber ?? '') === island);
  }
  if (typeof s['premium'] === 'boolean') filters.push((b) => b.isPremium === s['premium']);
  if (typeof s['blocked'] === 'boolean') filters.push((b) => b.isBlocked === s['blocked']);
  if (str(s['category'])) {
    const category = findCategory(ctx, str(s['category'])!);
    filters.push((b) => b.categoryIds.includes(category.id));
  }
  const width = num(s['width']);
  if (width !== null) filters.push((b) => Math.abs(b.width - width) < 0.01);
  const depth = num(s['depth']);
  if (depth !== null) filters.push((b) => Math.abs(b.depth - depth) < 0.01);
  if (!filters.length && s['all'] !== true) {
    throw new Error('Say which booths: labels, a zone, or another filter.');
  }
  return plan.stalls.filter((b) => filters.every((f) => f(b)));
}

function findZone(ctx: PlannerAgentCtx, name: string): PlanZone {
  const zones = ctx.store.plan().zones;
  const wanted = key(name);
  const zone =
    zones.find((z) => key(z.name) === wanted) ??
    zones.find((z) => key(z.name) === key(`Zone ${name}`));
  if (!zone) {
    throw new Error(
      `There is no zone “${name}”. Zones: ${zones.map((z) => z.name).join(', ') || 'none'}.`,
    );
  }
  return zone;
}

function findCategory(ctx: PlannerAgentCtx, name: string): { id: string; name: string } {
  const categories = ctx.store.categories();
  const wanted = name.trim().toLowerCase();
  const category =
    categories.find((c) => c.name.toLowerCase() === wanted) ??
    categories.find((c) => c.name.toLowerCase().includes(wanted));
  if (!category) {
    throw new Error(
      `This hall does not sell “${name}”. Categories: ${categories.map((c) => c.name).join(', ') || 'none'}.`,
    );
  }
  return category;
}

interface FillRegion {
  id: string;
  name: string;
  ring: Point[];
  /** Island the booths are numbered under: the zone's letter, or none for the hall. */
  island: string | null;
}

/** Where to fill: a named zone, every zone (the default when there are zones), or the hall. */
function fillRegions(ctx: PlannerAgentCtx, zone: string | null): FillRegion[] {
  const plan = ctx.store.plan();
  const wanted = zone?.trim().toLowerCase() ?? '';
  const asZone = (z: PlanZone): FillRegion => ({
    id: z.id,
    name: z.name,
    ring: z.polygon,
    island: z.name.replace(/^zone\s+/i, '').slice(0, 10) || null,
  });
  if (wanted && wanted !== 'hall' && wanted !== 'all zones' && wanted !== 'all') {
    return [asZone(findZone(ctx, zone!))];
  }
  if (wanted !== 'hall' && plan.zones.length) return plan.zones.map(asZone);
  const v = ctx.store.view()!;
  const floor = ctx.store.floor()!;
  const ring =
    floor.floor[0]?.[0] ?? rectRing({ x: 0, y: 0, width: v.hall.floor.width, height: v.hall.floor.depth });
  return [{ id: 'hall', name: 'the whole hall', ring, island: null }];
}

/** Places as booths, numbered under the island; rows open towards each other, as Auto-booths. */
function booths(ctx: PlannerAgentCtx, island: string | null, places: Rect[]): PlanStall[] {
  const plan = ctx.store.plan();
  const numbers = stallNumbers(plan.stalls, island, 'numbers', places.length, '');
  const rows = [...new Set(places.map((r) => r.y))].sort((a, b) => a - b);
  const facing = (r: Rect): StallSide[] => (rows.indexOf(r.y) % 2 ? ['top'] : ['bottom']);
  return places.map((r, i) => ({
    id: newId(),
    zoneId: zoneAt(centre(r), plan.zones)?.id ?? null,
    islandNumber: island,
    stallNumber: numbers[i],
    x: r.x,
    y: r.y,
    width: r.width,
    depth: r.height,
    openSides: facing(r),
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
  }));
}

/** The booth changes a tool call asks for, in Properties' terms. */
function stallPatch(ctx: PlannerAgentCtx, a: Args): StallPatch {
  const patch: StallPatch = {};
  if (typeof a['premium'] === 'boolean') patch.isPremium = a['premium'];
  if (typeof a['blocked'] === 'boolean') patch.isBlocked = a['blocked'];
  if (typeof a['active'] === 'boolean') patch.isActive = a['active'];
  if (typeof a['fnb'] === 'boolean') patch.isFnb = a['fnb'];
  if (a['scheme'] === 'shell' || a['scheme'] === 'raw') patch.scheme = a['scheme'];
  const category = str(a['category']);
  if (category) {
    patch.categoryIds = /^(none|no category|clear)$/i.test(category)
      ? []
      : [findCategory(ctx, category).id];
  }
  if (Array.isArray(a['open_sides'])) {
    const sides = (a['open_sides'] as unknown[]).filter((x): x is StallSide =>
      ['top', 'right', 'bottom', 'left'].includes(x as string),
    );
    patch.openSides = [...new Set(sides)];
  }
  if (typeof a['description'] === 'string') patch.description = a['description'].slice(0, 500) || null;
  if (str(a['island'])) patch.islandNumber = str(a['island'])!.slice(0, 10);
  return patch;
}

function describePatch(p: StallPatch): string {
  const parts: string[] = [];
  if (p.isPremium !== undefined) parts.push(p.isPremium ? 'premium' : 'not premium');
  if (p.isBlocked !== undefined) parts.push(p.isBlocked ? 'blocked' : 'for sale');
  if (p.isActive !== undefined) parts.push(p.isActive ? 'active' : 'inactive');
  if (p.isFnb !== undefined) parts.push(p.isFnb ? 'F&B' : 'not F&B');
  if (p.scheme) parts.push(p.scheme === 'raw' ? 'raw space' : 'shell scheme');
  if (p.categoryIds) parts.push(p.categoryIds.length ? 'category set' : 'category cleared');
  if (p.openSides) parts.push(`open ${p.openSides.join(', ') || 'nowhere'}`);
  if (p.description !== undefined) parts.push('description');
  if (p.islandNumber) parts.push(`island ${p.islandNumber}`);
  return parts.join(', ');
}

function boothFacts(ctx: PlannerAgentCtx, s: PlanStall) {
  const zones = ctx.store.plan().zones;
  const names = ctx.store.categoryName();
  return {
    label: label(s),
    zone: zones.find((z) => z.id === s.zoneId)?.name ?? null,
    x: s.x,
    y: s.y,
    width: s.width,
    depth: s.depth,
    open: s.openSides,
    scheme: s.scheme,
    premium: s.isPremium,
    blocked: s.isBlocked,
    active: s.isActive,
    categories: s.categoryIds.map((id) => names.get(id) ?? 'unknown'),
  };
}

/** The plan now, in few tokens. */
function summary(ctx: PlannerAgentCtx) {
  const store = ctx.store;
  const v = store.view();
  const plan: PlanContent = store.plan();
  const names = store.categoryName();
  const count = <T>(list: T[], keyOf: (t: T) => string[]) => {
    const m: Record<string, number> = {};
    for (const t of list) for (const k of keyOf(t)) m[k] = (m[k] ?? 0) + 1;
    return m;
  };
  return {
    hall: v ? { name: v.hall.hall.name, width: v.hall.floor.width, depth: v.hall.floor.depth } : null,
    unsavedChanges: store.dirty(),
    savedVersion: store.revision(),
    publishedVersion: store.published()?.revision ?? null,
    zones: plan.zones.map((z) => ({
      name: z.name,
      area: Math.round(polygonArea(z.polygon)),
      box: ringBox(z.polygon),
      booths: plan.stalls.filter((s) => s.zoneId === z.id).length,
      seats: plan.seats.filter((s) => s.zoneId === z.id).length,
    })),
    booths: {
      total: plan.stalls.length,
      inNoZone: plan.stalls.filter((s) => !s.zoneId).length,
      premium: plan.stalls.filter((s) => s.isPremium).length,
      blocked: plan.stalls.filter((s) => s.isBlocked).length,
      inactive: plan.stalls.filter((s) => !s.isActive).length,
      bySize: count(plan.stalls, (s) => [`${s.width}x${s.depth}`]),
      byCategory: count(plan.stalls, (s) => s.categoryIds.map((id) => names.get(id) ?? 'unknown')),
      labels:
        plan.stalls.length <= 60
          ? plan.stalls.map(label)
          : `${plan.stalls.length} booths; use find_booths for labels`,
    },
    seats: plan.seats.length,
    labelsOnPlan: plan.objects.filter((o) => o.kind === 'text').map((o) => o.text),
    categoriesSold: store.categories().map((c) => c.name),
    selected: store.selection(),
  };
}

/** A smooth turn of the 3D camera round the hall. */
function orbit(canvas: PlannerCanvasComponent): Promise<void> {
  const from = -35;
  canvas.enter3d(from);
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TOUR_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      if (!canvas.is3d()) return resolve();
      canvas.enter3d(from + eased * 360);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function rectArg(a: Args): Rect {
  const x = num(a['x']);
  const y = num(a['y']);
  const width = positive(a['width']);
  const depth = positive(a['depth']);
  if (x === null || y === null || width === null || depth === null) {
    throw new Error('Give x, y, width and depth in metres.');
  }
  return { x: round(x), y: round(y), width: round(width), height: round(depth) };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 && n <= 1000 ? n : null;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = num(v);
  return n === null ? fallback : Math.min(max, Math.max(min, Math.round(n)));
}
