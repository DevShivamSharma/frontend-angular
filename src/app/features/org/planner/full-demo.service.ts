import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { EventsApi } from '../../../core/events/events-api.service';
import type { PlanStall, PlanZone, StallSide } from '../../../core/plans/plans.models';
import { Notifier } from '../../../core/ui/notifier.service';
import type {
  MultiPolygon,
  PlanObject as SourceObject,
  PlanRegion,
  PlanReview,
  PlanView,
} from '../../../core/venues/floor-plan.models';
import { FloorPlansApi } from '../../../core/venues/floor-plans-api.service';
import { VenuesApi } from '../../../core/venues/venues-api.service';
import {
  centre,
  fillBooths,
  letters,
  newId,
  type Rect,
  rectRing,
  stallNumbers,
  zoneAt,
  zoneGrid,
  ZONE_COLORS,
} from './planner-geometry';
import type { PlannerCanvasComponent } from './planner-canvas.component';
import type { PlannerStore } from './planner.store';

export type DemoSpeed = 'slow' | 'quick';
export type DemoDrawing = 'sample' | 'file';

/** What the setup dialog closes with. */
export interface DemoConfig {
  speed: DemoSpeed;
  drawing: DemoDrawing;
  file: File | null;
  alsoPublish: boolean;
}

export type StepId =
  | 'new-hall'
  | 'import-drawing'
  | 'auto-zones'
  | 'auto-booths'
  | 'booth-details'
  | 'save'
  | 'publish'
  | 'exhibitors'
  | 'open-3d'
  | 'camera-tour';

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface DemoStep {
  id: StepId;
  label: string;
  status: StepStatus;
  /** Why a step was skipped or failed. */
  message: string;
}

/**
 * Where the demo stands: running a step, held by Pause, waiting for the person (a drawing the
 * demo cannot review by itself), stopped by an error, or finished.
 */
export type DemoState = 'idle' | 'running' | 'paused' | 'waiting' | 'error' | 'finished';

/** What the demo needs of the planner page it runs in. */
export interface DemoHost {
  store: PlannerStore;
  canvas: () => PlannerCanvasComponent | undefined;
  slug: string;
  eventId: string;
  hallId: string;
  /** Opens the planner of another hall of the event; resolves once the route has changed. */
  openHall: (hallId: string) => Promise<boolean>;
  openProperties: () => void;
}

/** The finished demo, for the panel's last words. */
export interface DemoResult {
  hallName: string;
  zones: number;
  booths: number;
  revision: number;
  published: number | null;
}

const STEP_DEFS: Array<{ id: StepId; label: string }> = [
  { id: 'new-hall', label: 'New hall' },
  { id: 'import-drawing', label: 'Import a drawing' },
  { id: 'auto-zones', label: 'Auto-zones' },
  { id: 'auto-booths', label: 'Booths in every zone' },
  { id: 'booth-details', label: "One booth's details" },
  { id: 'save', label: 'Save' },
  { id: 'publish', label: 'Publish' },
  { id: 'exhibitors', label: 'Exhibitors (Step 6)' },
  { id: 'open-3d', label: 'Open in 3D' },
  { id: 'camera-tour', label: 'Camera tour' },
];

/**
 * Pauses between what the demo does, for people to follow it: `beat` after each step, `short`
 * between the parts of one, `orbit` for the camera's full turn. Server work takes what it takes;
 * the pace only adds the time to look.
 */
const PACE: Record<DemoSpeed, { beat: number; short: number; orbit: number }> = {
  slow: { beat: 6000, short: 2000, orbit: 24000 },
  quick: { beat: 1800, short: 600, orbit: 9000 },
};

/** How often the demo asks whether a drawing has been read. */
const READ_POLL = 1500;
/** Longest wait for the drawing reader; a sample reads in seconds. */
const READ_TIMEOUT = 120_000;
/** Polls in a row that may fail (the server restarting) before the step fails. */
const READ_RETRIES = 10;
/** Longest wait for the planner to show the demo hall. */
const OPEN_TIMEOUT = 30_000;
/** Where the 3D view starts its turn, as the canvas's own Home does. */
const ORBIT_FROM = -35;

// ---- the sample hall --------------------------------------------------------------------------

const SAMPLE = { width: 72, depth: 48, wall: 0.3, exit: 6, column: 0.8 };

interface SampleShape {
  kind: 'wall' | 'column' | 'entry';
  label: string;
  color: string;
  rect: Rect;
}

/** The sample hall in metres, y down: outer walls with an exit in each, and two rows of columns. */
function sampleShapes(): SampleShape[] {
  const { width: w, depth: d, wall: t, exit: e } = SAMPLE;
  const [mx, my] = [(w - e) / 2, (d - e) / 2];
  const wall = (rect: Rect): SampleShape => ({ kind: 'wall', label: 'Wall', color: '#475569', rect });
  const exit = (rect: Rect): SampleShape => ({
    kind: 'entry',
    label: 'Exit',
    color: '#16a34a',
    rect,
  });
  const shapes: SampleShape[] = [
    wall({ x: 0, y: 0, width: mx, height: t }),
    wall({ x: mx + e, y: 0, width: w - mx - e, height: t }),
    wall({ x: 0, y: d - t, width: mx, height: t }),
    wall({ x: mx + e, y: d - t, width: w - mx - e, height: t }),
    wall({ x: 0, y: t, width: t, height: my - t }),
    wall({ x: 0, y: my + e, width: t, height: d - t - my - e }),
    wall({ x: w - t, y: t, width: t, height: my - t }),
    wall({ x: w - t, y: my + e, width: t, height: d - t - my - e }),
    exit({ x: mx, y: 0, width: e, height: 2 }),
    exit({ x: mx, y: d - 2, width: e, height: 2 }),
    exit({ x: 0, y: my, width: 2, height: e }),
    exit({ x: w - 2, y: my, width: 2, height: e }),
  ];
  const c = SAMPLE.column;
  for (const x of [18, 36, 54]) {
    for (const y of [16, 32]) {
      shapes.push({
        kind: 'column',
        label: 'Column',
        color: '#1e293b',
        rect: { x: x - c / 2, y: y - c / 2, width: c, height: c },
      });
    }
  }
  return shapes;
}

/**
 * The sample hall as an ASCII DXF in metres ($INSUNITS 6), so it goes through the same reader
 * as an architect's drawing. DXF y runs up; the reader turns it back to y down.
 */
function sampleDxf(): string {
  const d = SAMPLE.depth;
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC'];
  out.push('0', 'SECTION', '2', 'ENTITIES');
  const line = (layer: string, a: [number, number], b: [number, number]) =>
    out.push(
      '0', 'LINE', '8', layer,
      '10', String(a[0]), '20', String(d - a[1]), '30', '0',
      '11', String(b[0]), '21', String(d - b[1]), '31', '0',
    );
  const box = (layer: string, r: Rect) => {
    const p = rectRing(r);
    for (let i = 0; i < 4; i++) line(layer, p[i], p[(i + 1) % 4]);
  };
  box('OUTLINE', { x: 0, y: 0, width: SAMPLE.width, height: SAMPLE.depth });
  for (const s of sampleShapes()) {
    box(s.kind === 'wall' ? 'WALLS' : s.kind === 'column' ? 'COLUMNS' : 'EXITS', s.rect);
  }
  out.push('0', 'TEXT', '8', 'TEXT', '10', '30', '20', String(d - 25), '30', '0', '40', '1');
  out.push('1', 'DEMO HALL', '0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

/** A rectangle as a closed source polygon, in source units of `perMetre`. */
function sourceRect(r: Rect, metresPerUnit: number): MultiPolygon {
  const ring = rectRing(r).map(([x, y]) => [x / metresPerUnit, y / metresPerUnit] as [number, number]);
  return [[[...ring, ring[0]]]];
}

// ---- the demo ---------------------------------------------------------------------------------

/** Thrown to unwind a step when the demo is stopped. */
class Stopped extends Error {}

/** Thrown when the demo needs the person to do something before it can go on. */
class NeedsInput extends Error {
  constructor(
    message: string,
    readonly link: string[] | null,
    readonly query: Record<string, string> | null,
  ) {
    super(message);
  }
}

/**
 * The planner's automatic demo, "Full demo: hall to 3D". It makes a new hall in the event and
 * then does each step itself with the same APIs and store the buttons use: the venue's floor-plan
 * import, the rule-checked plan changes, Save and Publish, and the 3D view. A step is marked done
 * only when what it did came back from the server.
 *
 * Pause and Next step act between operations: an operation in flight always finishes first, so
 * nothing runs twice or overlaps. The hall that was open, and its plan, are left as they were.
 */
@Injectable()
export class FullDemoService {
  private readonly venues = inject(VenuesApi);
  private readonly floorPlans = inject(FloorPlansApi);
  private readonly events = inject(EventsApi);
  private readonly notifier = inject(Notifier);

  readonly state = signal<DemoState>('idle');
  readonly steps = signal<DemoStep[]>([]);
  readonly currentIndex = signal(-1);
  /** What is happening now, in a sentence. */
  readonly explanation = signal('');
  /** A page the person is asked to open (with its query), when the demo waits for them. */
  readonly waitLink = signal<{ link: string[]; query: Record<string, string> | null } | null>(
    null,
  );
  readonly result = signal<DemoResult | null>(null);
  /** An operation is in flight: Pause and Next step take effect when it finishes. */
  readonly working = signal(false);

  readonly active = computed(() => this.state() !== 'idle');
  readonly paused = computed(() => this.state() === 'paused');
  readonly finished = computed(() => this.state() === 'finished');
  readonly currentStep = computed<DemoStep | null>(() => this.steps()[this.currentIndex()] ?? null);
  /** The hall the demo was started from, to go back to. */
  readonly origin = signal<{ hallId: string; name: string } | null>(null);

  private host!: DemoHost;
  private config!: DemoConfig;
  private run = 0;
  /** Wakes whatever the demo waits on: the pace, Pause, or the person's answer. */
  private wake: (() => void) | null = null;
  private skipWait = false;
  /** The last read never finished: upload as a new import, not the stuck one. */
  private rereadFresh = false;
  private decision: 'retry' | 'stop' | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private frame = 0;

  /** What the steps made, so that a retried step carries on rather than repeating it. */
  private made: {
    venueId: string;
    hallId: string | null;
    hallName: string;
    hallVersion: number;
    documentId: string | null;
    imported: boolean;
    inEvent: boolean;
  } = this.fresh('');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  // ---- controls -------------------------------------------------------------------------------

  start(host: DemoHost, config: DemoConfig): void {
    if (this.active()) return;
    const view = host.store.view();
    if (!view) return;
    this.host = host;
    this.config = config;
    this.run++;
    this.made = this.fresh(view.hall.hall.venue.id);
    this.rereadFresh = false;
    this.origin.set({ hallId: host.hallId, name: view.hall.hall.name });
    this.steps.set(STEP_DEFS.map((d) => ({ ...d, status: 'pending', message: '' })));
    this.currentIndex.set(-1);
    this.result.set(null);
    this.waitLink.set(null);
    this.explanation.set('');
    this.state.set('running');
    void this.play(this.run);
  }

  pause(): void {
    if (this.state() === 'running') this.state.set('paused');
  }

  resume(): void {
    if (this.state() !== 'paused') return;
    this.state.set('running');
    this.wakeUp();
  }

  /** Cuts the current wait short; an operation in flight finishes first. */
  next(): void {
    if (this.state() === 'paused') this.state.set('running');
    if (this.state() !== 'running') return;
    this.skipWait = true;
    this.wakeUp();
  }

  /** After an error or a wait for the person: tries the step again. */
  retry(): void {
    if (this.state() !== 'error' && this.state() !== 'waiting') return;
    this.decision = 'retry';
    this.wakeUp();
  }

  /** Ends the demo; what it already made stays (the hall, and the plan as last saved). */
  stop(): void {
    if (!this.active()) return;
    this.run++;
    this.decision = 'stop';
    this.clearTimers();
    this.wakeUp();
    this.host?.canvas()?.home();
    this.state.set('idle');
    this.working.set(false);
  }

  /** Closes the panel at the end. */
  close(): void {
    this.state.set('idle');
  }

  /** Back to the hall the demo started from. */
  async backToOrigin(): Promise<void> {
    const origin = this.origin();
    this.close();
    if (origin) await this.host.openHall(origin.hallId);
  }

  // ---- the run --------------------------------------------------------------------------------

  private async play(run: number): Promise<void> {
    try {
      for (let i = 0; i < STEP_DEFS.length; i++) {
        this.currentIndex.set(i);
        this.mark(i, 'running', '');
        await this.attempt(run, i);
        if (this.steps()[i].status === 'running') this.mark(i, 'done', '');
        if (i < STEP_DEFS.length - 1) await this.wait(run, PACE[this.config.speed].beat);
      }
      this.finish();
    } catch (e) {
      if (!(e instanceof Stopped)) throw e;
    }
  }

  /** Runs a step until it succeeds, or the person stops the demo after an error. */
  private async attempt(run: number, i: number): Promise<void> {
    for (;;) {
      try {
        await this.step(run, STEP_DEFS[i].id);
        this.waitLink.set(null);
        return;
      } catch (e) {
        this.working.set(false);
        if (e instanceof Stopped || run !== this.run) throw new Stopped();
        const waiting = e instanceof NeedsInput;
        const message = errorText(e);
        this.mark(i, waiting ? 'running' : 'error', message);
        this.explanation.set(message);
        this.waitLink.set(waiting && e.link ? { link: e.link, query: e.query } : null);
        this.state.set(waiting ? 'waiting' : 'error');
        if ((await this.decide(run)) === 'stop') throw new Stopped();
        this.mark(i, 'running', '');
        this.state.set('running');
      }
    }
  }

  private async step(run: number, id: StepId): Promise<void> {
    switch (id) {
      case 'new-hall':
        return this.newHall(run);
      case 'import-drawing':
        return this.importDrawing(run);
      case 'auto-zones':
        return this.autoZones(run);
      case 'auto-booths':
        return this.autoBooths(run);
      case 'booth-details':
        return this.boothDetails(run);
      case 'save':
        return this.save(run);
      case 'publish':
        return this.publish(run);
      case 'exhibitors':
        return this.exhibitors(run);
      case 'open-3d':
        return this.open3d(run);
      case 'camera-tour':
        return this.cameraTour(run);
    }
  }

  // ---- the steps ------------------------------------------------------------------------------

  /** 1. A new hall in the event's venue, named "Demo hall" (numbered when that name is taken). */
  private async newHall(run: number): Promise<void> {
    const { slug } = this.host;
    if (this.made.hallId) return;
    this.explain(run, 'Making a new hall in this venue, named “Demo hall”…');
    const halls = await this.call(run, this.venues.halls(slug, this.made.venueId));
    const taken = new Set(halls.map((h) => h.name.toLowerCase()));
    let name = 'Demo hall';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `Demo hall ${n}`;
    const hall = await this.call(
      run,
      this.venues.createHall(slug, this.made.venueId, {
        name,
        code: null,
        level: null,
        uses: {},
        width: SAMPLE.width,
        depth: SAMPLE.depth,
      }),
    );
    this.made = { ...this.made, hallId: hall.id, hallName: hall.name, hallVersion: hall.currentVersion };
    this.explain(run, `“${hall.name}” is made: an empty ${hall.width} × ${hall.depth} m floor.`);
  }

  /**
   * 2. The drawing through the venue's floor-plan import: upload, read, review, and saved as the
   * demo hall's floor; then the hall joins the event (which keeps that floor) and opens here.
   */
  private async importDrawing(run: number): Promise<void> {
    if (!this.made.imported) {
      if (this.config.drawing === 'sample') await this.importSample(run);
      else await this.importFile(run);
      this.made = { ...this.made, imported: true };
    }
    const { slug, eventId } = this.host;
    const hallId = this.made.hallId!;
    if (!this.made.inEvent) {
      this.explain(run, `Adding “${this.made.hallName}” to this event…`);
      await this.call(run, this.events.addHalls(slug, eventId, [hallId]));
      this.made = { ...this.made, inEvent: true };
    }
    if (this.host.store.view()?.hall.hall.hallId !== hallId) {
      this.explain(run, `Opening “${this.made.hallName}” in the planner…`);
      this.working.set(true);
      const moved = await this.host.openHall(hallId);
      this.alive(run);
      if (!moved) throw new Error('The planner did not open the demo hall.');
      await this.until(run, () => this.host.store.view()?.hall.hall.hallId === hallId);
      this.working.set(false);
    }
    const floor = this.host.store.floor();
    this.explain(
      run,
      `The drawing is the floor of “${this.made.hallName}”: ${floor?.width ?? 0} × ${floor?.depth ?? 0} m, ` +
        `${floor?.pillars.length ?? 0} columns, walls and exits.`,
    );
    await this.wait(run, PACE[this.config.speed].short);
  }

  /** The sample: its review is known, so the demo confirms it as a person would. */
  private async importSample(run: number): Promise<void> {
    const { slug } = this.host;
    const venueId = this.made.venueId;
    let doc = await this.uploadAndRead(
      run,
      new File([sampleDxf()], 'demo-hall-sample.dxf', { type: 'application/dxf' }),
      true,
    );
    const page = doc.pages[0];
    if (!page) throw new Error('The drawing reader found no page in the sample.');
    this.explain(run, 'Reviewing the drawing: hall outline, walls, columns and exits…');
    // The reader keeps the drawing's own units; the sample spans the hall exactly.
    const perUnit = SAMPLE.width / page.width;
    const regionId = 'demo-hall';
    const region: PlanRegion = {
      id: regionId,
      name: this.made.hallName,
      role: 'hall',
      geometry: sourceRect({ x: 0, y: 0, width: SAMPLE.width, height: SAMPLE.depth }, perUnit),
      hallIds: [],
      confirmed: true,
      restrictionsConfirmed: true,
      grid: { x: 0, y: 0, width: 1 / perUnit, height: 1 / perUnit, rotation: 0 },
      printedArea: SAMPLE.width * SAMPLE.depth,
    };
    const objects: SourceObject[] = sampleShapes().map((s, i) => ({
      id: `demo-${s.kind}-${i + 1}`,
      kind: s.kind,
      label: s.label,
      geometry: sourceRect(s.rect, perUnit),
      color: s.color,
      confirmed: true,
      evidence: { source: 'user', detail: 'Sample hall of the full demo' },
    }));
    doc = await this.call(
      run,
      this.floorPlans.edit(slug, venueId, doc.id, doc.revision, {
        ...page,
        regions: [region],
        objects,
        grid: region.grid,
        calibration: { metresPerUnit: perUnit, source: 'DXF drawing units (metres)', confirmed: true },
        dimensions: [
          {
            id: 'demo-width',
            label: `Hall width ${SAMPLE.width} m`,
            a: [0, 0],
            b: [SAMPLE.width / perUnit, 0],
            metres: SAMPLE.width,
            regionId,
            confirmed: true,
          },
        ],
        annotations: [],
      }),
    );
    const review = doc.halls.find((h) => h.regionId === regionId);
    if (!review) throw new Error('The reviewed sample has no hall.');
    await this.commit(run, doc, review);
  }

  /**
   * A drawing of the person's own: read here; saved by the demo only when the reader found one
   * hall whose checks all pass. Anything else needs the person's review on the import page.
   */
  private async importFile(run: number): Promise<void> {
    const file = this.config.file;
    if (!file) throw new Error('No drawing was chosen. Stop the demo and start it with a file.');
    const doc = this.made.documentId
      ? await this.read(run, this.made.documentId)
      : await this.uploadAndRead(run, file, this.rereadFresh);
    // The person may have saved it into the demo hall on the import page meanwhile.
    const hall = await this.call(run, this.venues.hall(this.host.slug, this.made.hallId!));
    if (hall.currentVersion > this.made.hallVersion) return;
    const halls = doc.halls.filter((h) => !h.savedHallId);
    if (halls.length === 1 && halls[0].ready) {
      await this.commit(run, doc, halls[0]);
      return;
    }
    throw new NeedsInput(
      `“${file.name}” needs a person's review: ${
        halls.length === 1
          ? halls[0].checks
              .filter((c) => c.status !== 'pass')
              .map((c) => c.label)
              .slice(0, 3)
              .join(', ')
          : `${doc.halls.length} halls were found`
      }. Open the review, save the hall into “${this.made.hallName}”, then Continue.`,
      ['/', this.host.slug, 'venues', this.made.venueId, 'import-floor-plan'],
      { document: doc.id },
    );
  }

  private async uploadAndRead(run: number, file: File, fresh: boolean): Promise<PlanView> {
    this.explain(run, `Uploading “${file.name}” to the floor-plan import…`);
    const { id } = await this.call(
      run,
      this.floorPlans.upload(this.host.slug, this.made.venueId, file, fresh),
    );
    this.made = { ...this.made, documentId: id };
    this.explain(run, 'The drawing reader is finding the hall, walls, columns and exits…');
    return this.read(run, id);
  }

  /**
   * The import once its reader has finished. A poll that fails while the server restarts is
   * asked again; a reader that never finishes (its server restarted mid-read) is given up, and
   * Retry uploads the drawing again.
   */
  private async read(run: number, id: string): Promise<PlanView> {
    const end = Date.now() + READ_TIMEOUT;
    let failures = 0;
    for (;;) {
      let doc: PlanView | null = null;
      try {
        doc = await this.call(run, this.floorPlans.get(this.host.slug, this.made.venueId, id));
        failures = 0;
      } catch (e) {
        if (e instanceof Stopped || !transient(e) || ++failures > READ_RETRIES) throw e;
      }
      if (doc?.status === 'failed') {
        this.made = { ...this.made, documentId: null };
        throw new Error(doc.error ?? 'The drawing could not be read.');
      }
      if (doc?.status === 'ready') return doc;
      if (Date.now() > end) {
        this.made = { ...this.made, documentId: null };
        this.rereadFresh = true;
        throw new Error('The drawing reader did not finish. Retry uploads the drawing again.');
      }
      await this.sleep(run, READ_POLL);
    }
  }

  /** Saves the reviewed hall as the demo hall's floor, acknowledging only overridable warnings. */
  private async commit(run: number, doc: PlanView, review: PlanReview): Promise<void> {
    const blocking = review.checks.filter((c) => c.status !== 'pass' && !c.overridable);
    if (blocking.length) {
      throw new Error(`The drawing's review is not complete: ${blocking.map((c) => c.label).join(', ')}.`);
    }
    this.explain(run, `Saving the drawing as the floor of “${this.made.hallName}”…`);
    const hallId = this.made.hallId!;
    const [result] = await this.call(
      run,
      this.floorPlans.commit(this.host.slug, this.made.venueId, doc.id, doc.revision, [
        {
          key: review.key,
          name: this.made.hallName,
          targetHallId: hallId,
          expectedVersion:
            review.existing.find((e) => e.id === hallId)?.version ?? this.made.hallVersion,
          acknowledgements: review.checks
            .filter((c) => c.status !== 'pass' && c.overridable)
            .map((c) => c.id),
        },
      ]),
    );
    if (!result || result.error) throw new Error(result?.error ?? 'The drawing was not saved.');
    this.made = { ...this.made, hallVersion: result.version ?? this.made.hallVersion + 1 };
  }

  /** 3. Zones on a grid over the open floor, with cross aisles between them. */
  private async autoZones(run: number): Promise<void> {
    const store = this.host.store;
    if (store.plan().zones.length) {
      this.explain(run, `${store.plan().zones.length} zones are already on the plan.`);
      return;
    }
    const floor = store.floor();
    if (!floor) throw new Error('The hall floor is not loaded.');
    const rects = zoneGrid(floor, this.passage());
    if (!rects.length) throw new Error('The floor has no room for zones.');
    this.explain(run, `Dividing the floor into ${rects.length} zones with aisles between them…`);
    const zones: PlanZone[] = rects.map((r, i) => ({
      id: newId(),
      name: `Zone ${letters(i)}`,
      color: ZONE_COLORS[i % ZONE_COLORS.length],
      polygon: rectRing(r),
    }));
    const plan = store.plan();
    const ok = await this.op(run, () =>
      store.change({ ...plan, zones: [...plan.zones, ...zones] }, zones.map((z) => z.id), {
        kind: 'zone',
        ids: zones.map((z) => z.id),
      }),
    );
    if (!ok) throw new Error('The zones were not added: the toast says which rule refused them.');
    this.explain(run, `${zones.map((z) => z.name).join(', ')} are on the plan.`);
  }

  /** 4. Auto-booths in each zone in turn, as the Auto-booths dialog fills a zone. */
  private async autoBooths(run: number): Promise<void> {
    const store = this.host.store;
    const zones = store.plan().zones;
    if (!zones.length) throw new Error('There are no zones to fill.');
    let added = 0;
    let dropped = 0;
    for (const zone of zones) {
      const floor = store.floor();
      if (!floor) throw new Error('The hall floor is not loaded.');
      const plan = store.plan();
      if (plan.stalls.some((s) => s.zoneId === zone.id)) continue;
      this.explain(run, `Filling ${zone.name} with 3 × 3 m booths, each open onto an aisle…`);
      const places = fillBooths(
        {
          region: zone.polygon,
          width: 3,
          depth: 3,
          aisle: this.passage(),
          margin: 0.5,
          count: null,
          pillarClearance: 0.5,
          shiftForPillars: true,
          sellPillarStands: false,
        },
        floor,
        plan.stalls,
        plan.seats,
      );
      if (!places.length) continue;
      const result = await this.op(run, () =>
        store.addPassing({ stalls: this.booths(zone, places) }),
      );
      if (result) {
        added += result.added;
        dropped += result.dropped;
      }
      await this.wait(run, PACE[this.config.speed].short);
    }
    if (!store.plan().stalls.length) {
      throw new Error('No booth fitted the zones under this hall’s rules.');
    }
    this.explain(
      run,
      `${added} booths are on the plan` +
        (dropped ? `; ${dropped} were left out because they break a rule.` : '.'),
    );
  }

  /** The places as booths of a zone, numbered under its letter; rows open towards each other. */
  private booths(zone: PlanZone, places: Rect[]): PlanStall[] {
    const store = this.host.store;
    const island = zone.name.replace(/^Zone\s+/, '');
    const numbers = stallNumbers(store.plan().stalls, island, 'numbers', places.length, '');
    const rows = [...new Set(places.map((r) => r.y))].sort((a, b) => a - b);
    const facing = (r: Rect): StallSide[] => (rows.indexOf(r.y) % 2 ? ['top'] : ['bottom']);
    const zones = store.plan().zones;
    return places.map((r, i) => ({
      id: newId(),
      zoneId: zoneAt(centre(r), zones)?.id ?? zone.id,
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

  /** 5. One booth selected, shown in Properties, and its details changed there. */
  private async boothDetails(run: number): Promise<void> {
    const store = this.host.store;
    const booth = store.plan().stalls[0];
    if (!booth) throw new Error('There is no booth to show.');
    const label = `${booth.islandNumber ?? ''}-${booth.stallNumber}`;
    this.host.openProperties();
    store.select({ kind: 'stall', ids: [booth.id] });
    this.explain(run, `Booth ${label} is selected: its details are in Properties on the right.`);
    await this.wait(run, PACE[this.config.speed].beat);
    const category = store.categories()[0];
    const changed: PlanStall = {
      ...booth,
      scheme: 'raw',
      isPremium: true,
      categoryIds: category ? [category.id] : booth.categoryIds,
      description: 'Corner booth by the main aisle.',
    };
    this.explain(
      run,
      `Booth ${label}: premium, raw space` + (category ? `, sells “${category.name}”` : '') + '…',
    );
    const plan = store.plan();
    const ok = await this.op(run, () =>
      store.change(
        { ...plan, stalls: plan.stalls.map((s) => (s.id === booth.id ? changed : s)) },
        [booth.id],
        { kind: 'stall', ids: [booth.id] },
      ),
    );
    if (!ok) throw new Error(`Booth ${label} was not changed: the toast says which rule refused it.`);
    this.explain(run, `Booth ${label} is now premium raw space; Properties shows the change.`);
  }

  /** 6. Save, as the Save button does. */
  private async save(run: number): Promise<void> {
    const store = this.host.store;
    if (!store.dirty() && store.revision() > 0) return;
    this.explain(run, 'Saving the stall plan…');
    const ok = await this.op(run, () => store.save());
    if (!ok) throw new Error('The plan was not saved: the message above says why.');
    this.explain(run, `Saved as version ${store.revision()}.`);
  }

  /** 7. Publish only when chosen in the setup and allowed; otherwise skipped, and why. */
  private async publish(run: number): Promise<void> {
    const store = this.host.store;
    if (!this.config.alsoPublish) {
      this.skip(run, 'Skipped: “Also publish the demo hall” was not chosen.');
      return;
    }
    if (!store.view()?.canPublish) {
      this.skip(run, 'Skipped: you may not publish stall plans in this event.');
      return;
    }
    if (store.upToDate()) return;
    this.explain(run, `Publishing version ${store.revision()}; the rules are checked once more…`);
    const ok = await this.op(run, () => store.publish());
    if (!ok) throw new Error('The plan was not published: the message above says why.');
    this.explain(run, `Version ${store.published()?.revision} is published.`);
  }

  /** 8. What exhibitors are offered: the published plan, in 2D with its numbers; or nothing yet. */
  private async exhibitors(run: number): Promise<void> {
    const store = this.host.store;
    const published = store.published();
    if (!published) {
      this.skip(
        run,
        'Skipped: the demo hall is not published, so exhibitors cannot see it or book in it.',
      );
      return;
    }
    store.select(null);
    const canvas = this.host.canvas();
    canvas?.leave3d();
    canvas?.fit();
    const free = store.plan().stalls.filter((s) => s.isActive && !s.isBlocked).length;
    this.explain(
      run,
      `Exhibitors are offered version ${published.revision}: ${free} booths to book, as shown here.`,
    );
  }

  /** 9. The hall in 3D. */
  private async open3d(run: number): Promise<void> {
    const canvas = this.host.canvas();
    if (!canvas) throw new Error('The planner view is not ready.');
    this.explain(run, 'Opening the hall in 3D: walls, columns and booths stand up…');
    this.host.store.select(null);
    canvas.enter3d(ORBIT_FROM);
    await this.until(run, () => canvas.is3d());
  }

  /** 10. One slow turn round the hall; Pause holds the camera where it is. */
  private async cameraTour(run: number): Promise<void> {
    const canvas = this.host.canvas();
    if (!canvas) throw new Error('The planner view is not ready.');
    if (!canvas.is3d()) canvas.enter3d(ORBIT_FROM);
    this.explain(run, 'A camera tour round the hall…');
    this.skipWait = false;
    const total = PACE[this.config.speed].orbit;
    await new Promise<void>((resolve) => {
      let shown = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (run !== this.run) return resolve();
        if (this.state() === 'running') shown += now - last;
        last = now;
        const t = Math.min(1, shown / total);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        canvas.enter3d(ORBIT_FROM + eased * 360);
        if (t >= 1 || this.skipWait) {
          this.skipWait = false;
          this.frame = 0;
          return resolve();
        }
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
    this.alive(run);
    canvas.enter3d(ORBIT_FROM);
  }

  private finish(): void {
    const store = this.host.store;
    const p = store.plan();
    this.result.set({
      hallName: this.made.hallName,
      zones: p.zones.length,
      booths: p.stalls.length,
      revision: store.revision(),
      published: store.published()?.revision ?? null,
    });
    this.currentIndex.set(-1);
    this.explanation.set('');
    this.state.set('finished');
    this.notifier.success(`The demo is done: “${this.made.hallName}” is ready.`);
  }

  // ---- helpers --------------------------------------------------------------------------------

  private fresh(venueId: string): FullDemoService['made'] {
    return {
      venueId,
      hallId: null,
      hallName: 'Demo hall',
      hallVersion: 1,
      documentId: null,
      imported: false,
      inEvent: false,
    };
  }

  /** The event's passage width, as Auto-booths uses for its aisles. */
  private passage(): number {
    const v = this.host.store.view();
    return v ? v.hall.rules.values.passageWidth[v.hall.event.audience] : 3;
  }

  private mark(index: number, status: StepStatus, message: string): void {
    this.steps.update((steps) => steps.map((s, i) => (i === index ? { ...s, status, message } : s)));
  }

  private skip(run: number, message: string): void {
    this.alive(run);
    this.mark(this.currentIndex(), 'skipped', message);
    this.explanation.set(message);
  }

  private explain(run: number, text: string): void {
    this.alive(run);
    this.explanation.set(text);
  }

  /** Throws once this run was stopped. */
  private alive(run: number): void {
    if (run !== this.run) throw new Stopped();
  }

  /** An API call; HTTP errors become the step's error (the interceptor has shown a toast). */
  private async call<T>(run: number, source: Observable<T>): Promise<T> {
    return this.op(run, () => firstValueFrom(source));
  }

  /** An operation the demo waits for; Pause and Next step act once it is done. */
  private async op<T>(run: number, work: () => Promise<T>): Promise<T> {
    this.alive(run);
    this.working.set(true);
    try {
      return await work();
    } finally {
      this.working.set(false);
      this.alive(run);
    }
  }

  /** A presentation pause: held by Pause, cut short by Next step. */
  private async wait(run: number, ms: number): Promise<void> {
    while (this.state() === 'paused') await this.signal(run);
    this.alive(run);
    if (this.skipWait) {
      this.skipWait = false;
      return;
    }
    await this.sleep(run, ms, true);
    while (this.state() === 'paused') await this.signal(run);
    this.alive(run);
    this.skipWait = false;
  }

  /** Waits `ms`; when `wakeable`, Next step and Stop end it early. */
  private sleep(run: number, ms: number, wakeable = false): Promise<void> {
    this.alive(run);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (wakeable) this.wake = null;
        resolve();
      }, ms);
      this.timers.add(timer);
      if (wakeable) {
        this.wake = () => {
          clearTimeout(timer);
          this.timers.delete(timer);
          resolve();
        };
      }
    }).then(() => this.alive(run));
  }

  /** Until Resume, Next step, Retry or Stop. */
  private signal(run: number): Promise<void> {
    this.alive(run);
    return new Promise<void>((resolve) => (this.wake = resolve)).then(() => this.alive(run));
  }

  /** What the person chose after an error or a wait: try again, or stop. */
  private async decide(run: number): Promise<'retry' | 'stop'> {
    this.decision = null;
    while (!this.decision) {
      try {
        await this.signal(run);
      } catch {
        return 'stop';
      }
    }
    return this.decision;
  }

  /** Waits until `ready`, checking as the page updates; fails after {@link OPEN_TIMEOUT}. */
  private async until(run: number, ready: () => boolean): Promise<void> {
    const end = Date.now() + OPEN_TIMEOUT;
    while (!ready()) {
      if (Date.now() > end) throw new Error('The planner took too long to show the demo hall.');
      await this.sleep(run, 150);
    }
  }

  private wakeUp(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

/** A failure worth asking again: no answer, or the server (or its proxy) briefly down. */
function transient(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 0 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** The message of a failed operation: the server's when it gave one. */
function errorText(e: unknown): string {
  const err = e as { error?: { message?: string | string[] }; message?: string };
  const server = err?.error?.message;
  if (Array.isArray(server)) return server.join(' ');
  return server ?? err?.message ?? 'Something went wrong.';
}
