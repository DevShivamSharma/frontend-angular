import {
  afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, Injector,
  OnInit, signal, untracked, viewChild
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { NotifyService } from '../../core/notify.service';
import { stallArea } from '../geometry/footprint-view';
import { planSize } from '../geometry/hall-plan';
import { IconComponent, IconName } from '../components/icon.component';
import { RulePickerDialogComponent } from '../components/rule-picker-dialog.component';
import type { GateSide, Stall } from '../models/stall.model';
import { PdfImportDialogComponent } from '../pdf-import/pdf-import-dialog.component';
import { PlannerStore } from '../planner-store.service';
import { CadCanvasComponent } from './cad-canvas.component';
import { aliasOf, CommandName, commandInfo } from './cad-commands';
import { formatSize, parseNumber, parseSize, trim } from './cad-input';
import { DraftingEngine, LayerId, LAYERS } from './drafting-engine.service';

type RibbonTab = 'home' | 'stalls' | 'rules' | 'view' | 'publish';

interface RibbonButton {
  command: CommandName;
  label: string;
  icon?: IconName;
}

interface RibbonGroup {
  title: string;
  buttons: RibbonButton[];
}

const RIBBON: Record<RibbonTab, RibbonGroup[]> = {
  home: [
    { title: 'Stalls', buttons: [
      { command: 'STALL', label: 'Stall', icon: 'store' },
      { command: 'STALLROW', label: 'Row', icon: 'draw' },
      { command: 'ISLAND', label: 'Island', icon: 'grid' }
    ] },
    { title: 'Modify', buttons: [
      { command: 'MOVE', label: 'Move', icon: 'move' },
      { command: 'COPY', label: 'Copy', icon: 'copy' },
      { command: 'ROTATE', label: 'Rotate', icon: 'rotate' },
      { command: 'MIRROR', label: 'Mirror' },
      { command: 'ARRAY', label: 'Array' },
      { command: 'ERASE', label: 'Erase', icon: 'trash' }
    ] },
    { title: 'Measure', buttons: [
      { command: 'DIST', label: 'Distance' },
      { command: 'AREA', label: 'Area' },
      { command: 'ID', label: 'ID point' }
    ] },
    { title: 'Assist', buttons: [
      { command: 'ASSIST', label: 'AI Assist', icon: 'sparkles' },
      { command: 'PDFPLOT', label: 'From PDF', icon: 'file' }
    ] }
  ],
  stalls: [
    { title: 'Edit', buttons: [
      { command: 'OPENSIDE', label: 'Open sides' },
      { command: 'SPLIT', label: 'Split' },
      { command: 'MERGE', label: 'Merge' },
      { command: 'MATCHPROP', label: 'Match' }
    ] },
    { title: 'Layout', buttons: [
      { command: 'RENUMBER', label: 'Number' },
      { command: 'CHECK', label: 'Check', icon: 'shield' }
    ] }
  ],
  rules: [
    { title: 'Check', buttons: [{ command: 'CHECK', label: 'Check all', icon: 'shield' }] }
  ],
  view: [
    { title: 'Navigate', buttons: [
      { command: 'ZOOM', label: 'Zoom', icon: 'search' },
      { command: 'PAN', label: 'Pan', icon: 'move' },
      { command: 'SELECTALL', label: 'Select all', icon: 'pointer' }
    ] }
  ],
  publish: [
    { title: 'Layout', buttons: [
      { command: 'QSAVE', label: 'Save', icon: 'save' },
      { command: 'EXPORT', label: 'Portal JSON', icon: 'upload' }
    ] }
  ]
};

const TABS: ReadonlyArray<{ id: RibbonTab; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'stalls', label: 'Stalls' },
  { id: 'rules', label: 'Rules' },
  { id: 'view', label: 'View' },
  { id: 'publish', label: 'Publish' }
];

const TOGGLES = [
  { id: 'grid', label: 'GRID', key: 'F7' },
  { id: 'snap', label: 'SNAP', key: 'F9' },
  { id: 'ortho', label: 'ORTHO', key: 'F8' },
  { id: 'polar', label: 'POLAR', key: 'F10' },
  { id: 'osnap', label: 'OSNAP', key: 'F3' },
  { id: 'dyn', label: 'DYN', key: 'F12' }
] as const;

const F_KEYS: Record<string, (typeof TOGGLES)[number]['id']> = { F3: 'osnap', F7: 'grid', F8: 'ortho', F9: 'snap', F10: 'polar', F12: 'dyn' };

/** Side names as the plan shows them: FRONT is the bottom edge (+Z). */
const SIDE_LABELS: ReadonlyArray<{ side: GateSide; label: string }> = [
  { side: 'BACK', label: 'Top' },
  { side: 'RIGHT', label: 'Right' },
  { side: 'FRONT', label: 'Bottom' },
  { side: 'LEFT', label: 'Left' }
];

/**
 * The architect's drafting workspace (`/planner/draft`): an AutoCAD-like 2D model space over the
 * imported hall, with a ribbon, layers, a properties palette, the command line and the status bar.
 * The 3D planner stays as the preview of the same layout.
 */
@Component({
  selector: 'app-drafting-page',
  templateUrl: './drafting-page.component.html',
  providers: [PlannerStore, DraftingEngine],
  imports: [CadCanvasComponent, IconComponent, RulePickerDialogComponent, PdfImportDialogComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DraftingPageComponent implements OnInit {
  readonly store = inject(PlannerStore);
  readonly engine = inject(DraftingEngine);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);

  private readonly cmdInput = viewChild.required<ElementRef<HTMLInputElement>>('cmd');
  private readonly historyBox = viewChild<ElementRef<HTMLElement>>('historyBox');
  private readonly propertiesPanel = viewChild<ElementRef<HTMLElement>>('properties');
  private readonly rulePicker = viewChild.required(RulePickerDialogComponent);

  readonly tabs = TABS;
  readonly toggleList = TOGGLES;
  readonly layerList = LAYERS;
  readonly sideLabels = SIDE_LABELS;
  readonly tab = signal<RibbonTab>('home');
  readonly groups = computed(() => RIBBON[this.tab()]);
  readonly cmdText = signal('');
  readonly customSize = signal('');
  readonly historyOpen = signal(false);

  private commandRecall: string[] = [];
  private recallIndex = -1;
  private landed = false;
  private appliedParams = '';

  readonly hall = this.store.currentHall;
  readonly selected = this.engine.selectedStalls;
  readonly single = computed(() => (this.selected().length === 1 ? this.selected()[0] : null));
  readonly selectedArea = computed(() => trim(this.selected().reduce((a, s) => a + stallArea(s), 0)));
  readonly sizeText = computed(() => formatSize(this.engine.size()));
  readonly planText = computed(() => {
    const hall = this.hall();
    const plan = this.engine.plan();
    if (!hall || !plan) return '';
    const size = plan ? { width: plan.maxX - plan.minX, length: plan.maxZ - plan.minZ } : planSize(hall);
    return `${trim(size.width, 1)} × ${trim(size.length, 1)} m`;
  });
  readonly lastLines = computed(() => this.engine.history().slice(this.historyOpen() ? -40 : -3));
  readonly issueItems = computed(() => {
    const stalls = new Map(this.store.currentStalls().map(s => [String(s.id), s]));
    return this.engine.issues().flatMap(e => e.violations.map((v, i) => ({
      key: `${e.stallId}-${i}`,
      id: e.stallId,
      name: stalls.get(e.stallId)?.stallNumber ?? stalls.get(e.stallId)?.name ?? '',
      message: v.message,
      ref: v.ruleRef
    })));
  });
  readonly singleIssues = computed(() => {
    const s = this.single();
    return s ? this.issueItems().filter(i => i.id === String(s.id)) : [];
  });
  readonly rules = computed(() => this.store.placementContext()?.rules ?? null);
  readonly coords = computed(() => {
    const c = this.engine.cursor();
    if (!c) return null;
    const p = this.engine.frame().toCad(c);
    return `${p.x.toFixed(2)}, ${p.y.toFixed(2)}`;
  });
  /** Open sides shared by every selected stall (tri-state per side). */
  readonly sharedSides = computed(() => {
    const list = this.selected().filter(s => !s.footprint?.length);
    return Object.fromEntries(SIDE_LABELS.map(({ side }) => {
      const n = list.filter(s => s.openSides.includes(side)).length;
      return [side, n === 0 ? 'off' : n === list.length ? 'on' : 'mixed'];
    })) as Record<GateSide, 'on' | 'off' | 'mixed'>;
  });

  constructor() {
    // Deep links: `?hallId=` from the setup steps, `?layoutId=` to reopen a saved layout.
    effect(() => {
      const params = this.params();
      if (this.store.hallsStatus() === 'loading') return;
      const hallId = params?.get('hallId') ?? '';
      const layoutId = params?.get('layoutId') ?? '';
      const key = `${hallId}|${layoutId}`;
      if (key === this.appliedParams) return;
      this.appliedParams = key;
      untracked(() => void this.applyParams(hallId, layoutId));
    });

    // Rule picker once on landing, when there are plotting rules to pick from.
    effect(() => {
      const status = this.store.plannerRulesStatus();
      if (this.landed || status === 'loading') return;
      this.landed = true;
      if (status === 'ready' && this.store.plannerRules().length && !this.params()?.get('layoutId')) {
        untracked(() => afterNextRender(() => this.rulePicker().open(), { injector: this.injector }));
      }
    });

    // Store errors (save rejected, open failed) as toasts.
    effect(() => {
      const message = this.store.error().replace(/^(?:❌|⚠️?)\s*/, '');
      if (!message) return;
      untracked(() => {
        const parts = message.match(/^([^:]+):\s+([\s\S]+)$/);
        this.notify.error(parts?.[1] ?? 'Not allowed', parts?.[2] ?? message);
        this.engine.log(message, 'error');
      });
    });

    // The newest command-line line stays in view.
    effect(() => {
      this.lastLines();
      untracked(() => afterNextRender(() => {
        const el = this.historyBox()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, { injector: this.injector }));
    });

    // PR brings the palette into view.
    effect(() => {
      if (!this.engine.propertiesRequest()) return;
      untracked(() => this.propertiesPanel()?.nativeElement.scrollIntoView({ block: 'nearest' }));
    });

    // Default stall size: the first configured type.
    effect(() => {
      const first = this.store.stallTypes()[0];
      if (first && !this.customSize()) untracked(() => this.engine.setSize({ width: first.width, depth: first.height }));
    });
  }

  ngOnInit(): void {
    void this.store.loadPlannerRules();
    void this.store.loadHalls();
    void this.store.loadList();
    void this.store.loadStallTypes();
  }

  private async applyParams(hallId: string, layoutId: string): Promise<void> {
    if (layoutId) {
      await this.store.openLayout(layoutId);
    } else if (hallId) {
      const hall = this.store.halls().find(h => String(h.id) === hallId);
      if (hall) this.store.setActiveHall(hall.id);
      else this.notify.error('Hall unavailable', 'The chosen hall could not be loaded. Pick one from the hall list.');
    }
    this.engine.resetHistory();
    this.engine.markClean();
    this.engine.zoomExtents();
  }

  // --- ribbon ----------------------------------------------------------------------------------------

  alias(name: CommandName): string {
    return aliasOf(name);
  }

  tip(b: RibbonButton): string {
    return `${commandInfo(b.command).help} (${aliasOf(b.command)})`;
  }

  run(name: CommandName): void {
    void this.engine.run(name);
    this.focusCommandLine();
  }

  // --- hall and layout ---------------------------------------------------------------------------------

  async chooseHall(id: string): Promise<void> {
    if (!(await this.discardOk())) return;
    const hall = this.store.halls().find(h => String(h.id) === id);
    if (!hall) return;
    this.store.setActiveHall(hall.id);
    this.store.selectedSavedId.set(null);
    this.store.setLayoutName('');
    this.engine.resetHistory();
    this.engine.markClean();
    this.engine.zoomExtents();
    void this.router.navigate([], { queryParams: { hallId: hall.id, layoutId: null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.appliedParams = `${hall.id}|`;
  }

  async openLayout(id: string): Promise<void> {
    if (!id || !(await this.discardOk())) return;
    await this.store.openLayout(id);
    this.engine.resetHistory();
    this.engine.markClean();
    this.engine.zoomExtents();
    this.appliedParams = `|${id}`;
    void this.router.navigate([], { queryParams: { layoutId: id, hallId: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  async saveAsNew(): Promise<void> {
    this.store.selectedSavedId.set(null);
    this.store.setLayoutName('');
    await this.engine.run('QSAVE');
  }

  private async discardOk(): Promise<boolean> {
    if (!this.engine.dirty()) return true;
    return this.notify.confirm({
      title: 'Discard unsaved changes?',
      text: 'The stalls drawn since the last save will be lost.',
      confirmText: 'Discard',
      danger: true
    });
  }

  async open3d(): Promise<void> {
    const saved = this.store.selectedSavedId();
    if (this.engine.dirty()) {
      const ok = await this.notify.confirm({
        title: 'Open the 3D view?',
        text: saved === null
          ? 'The 3D view opens the hall without the stalls drawn here. Save first to see them.'
          : 'The 3D view shows the layout as last saved; changes since then are not included.',
        confirmText: 'Open 3D view'
      });
      if (!ok) return;
    }
    void this.router.navigate(['/planner/editor'], {
      queryParams: saved !== null ? { layoutId: saved } : { hallId: this.hall()?.id }
    });
  }

  // --- palette ----------------------------------------------------------------------------------------

  pickSize(width: number, depth: number): void {
    this.customSize.set('');
    this.engine.setSize({ width, depth });
  }

  applyCustomSize(text: string): void {
    const size = parseSize(text);
    if (!size) {
      this.notify.error('Size not understood', 'Type frontage x depth in metres, e.g. 4x3.');
      return;
    }
    this.customSize.set(formatSize(size));
    this.engine.setSize(size);
  }

  isSize(width: number, depth: number): boolean {
    const s = this.engine.size();
    return s.width === width && s.depth === depth;
  }

  setLayer(id: LayerId, on: boolean): void {
    this.engine.setLayer(id, on);
  }

  private ids(): Set<string> {
    return new Set(this.selected().map(s => String(s.id)));
  }

  rename(value: string): void {
    const name = value.trim();
    if (name) this.engine.updateStalls(this.ids(), s => ({ ...s, name }), 'Rename');
  }

  setDimension(which: 'width' | 'length', value: string): void {
    const v = parseNumber(value);
    if (v === null || v <= 0 || v > 200) return;
    this.engine.updateStalls(this.ids(), s => ({ ...s, [which]: v }), 'Size');
  }

  /** Corner X/Y: the bottom-left corner in CAD coordinates, as STALL inserts it. */
  corner(s: Stall): { x: string; y: string } {
    const c = this.engine.frame().toCad({ x: s.posX - s.width / 2, z: s.posZ + s.length / 2 });
    return { x: trim(c.x, 3), y: trim(c.y, 3) };
  }

  setCorner(axis: 'x' | 'y', value: string): void {
    const s = this.single();
    const v = parseNumber(value);
    if (!s || v === null) return;
    const frame = this.engine.frame();
    const c = frame.toCad({ x: s.posX - s.width / 2, z: s.posZ + s.length / 2 });
    const w = frame.toWorld(axis === 'x' ? { x: v, y: c.y } : { x: c.x, y: v });
    this.engine.updateStalls(this.ids(), st => ({ ...st, posX: w.x + st.width / 2, posZ: w.z - st.length / 2 }), 'Position');
  }

  setSide(side: GateSide, on: boolean): void {
    this.engine.updateStalls(this.ids(), s => {
      if (s.footprint?.length) return s;
      const sides = on ? [...new Set([...s.openSides, side])] : s.openSides.filter(x => x !== side);
      return sides.length ? { ...s, openSides: sides, gateSide: sides[0] } : s;
    }, 'Open sides');
  }

  setColour(value: string): void {
    this.engine.updateStalls(this.ids(), s => ({ ...s, color: value }), 'Colour');
  }

  setHeight(value: string): void {
    const v = parseNumber(value);
    if (v !== null && v > 0 && v <= 30) this.engine.updateStalls(this.ids(), s => ({ ...s, height: v }), 'Height');
  }

  area(s: Stall): string {
    return trim(stallArea(s));
  }

  focusIssue(id: string): void {
    const stall = this.store.currentStalls().find(s => String(s.id) === id);
    if (!stall) return;
    this.engine.select([id]);
    this.engine.zoomTo({ minX: stall.posX - stall.width, maxX: stall.posX + stall.width, minZ: stall.posZ - stall.length, maxZ: stall.posZ + stall.length }, 8);
  }

  chooseRules(): void {
    this.rulePicker().open();
  }

  // --- command line and keyboard ------------------------------------------------------------------------

  focusCommandLine(): void {
    this.cmdInput().nativeElement.focus({ preventScroll: true });
  }

  private submit(): void {
    const text = this.cmdText();
    if (text.trim()) {
      this.commandRecall = [...this.commandRecall.filter(t => t !== text), text].slice(-50);
    }
    this.recallIndex = -1;
    this.cmdText.set('');
    this.cmdInput().nativeElement.value = '';
    this.engine.submit(text);
  }

  onCmdInput(value: string): void {
    this.cmdText.set(value);
  }

  @HostListener('document:keydown', ['$event'])
  keydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('dialog')) return;
    const inCmd = target === this.cmdInput().nativeElement;
    const inField = !inCmd && !!target?.closest('input, textarea, select, [contenteditable="true"]');

    const toggle = F_KEYS[e.key];
    if (toggle) {
      e.preventDefault();
      this.engine.toggle(toggle);
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      this.engine.submit('?');
      return;
    }
    if (inField) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const key = e.key.toLowerCase();
      const action = key === 'z' && !e.shiftKey ? 'UNDO'
        : key === 'y' || (key === 'z' && e.shiftKey) ? 'REDO'
        : key === 's' ? 'QSAVE'
        : key === 'a' ? 'SELECTALL'
        : null;
      if (action) {
        e.preventDefault();
        void this.engine.run(action);
      }
      return;
    }
    if (e.altKey) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.cmdText.set('');
        this.cmdInput().nativeElement.value = '';
        this.engine.escape();
        return;
      case 'Enter':
        e.preventDefault();
        this.submit();
        return;
      case ' ':
        if (this.engine.spaceTypes() && inCmd) return;
        e.preventDefault();
        this.submit();
        return;
      case 'Delete':
        if (!this.cmdText() && !this.engine.request() && this.selected().length) {
          e.preventDefault();
          this.engine.erase([...this.ids()]);
        }
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!inCmd || !this.commandRecall.length) return;
        e.preventDefault();
        this.recall(e.key === 'ArrowUp' ? -1 : 1);
        return;
    }
    // Typing anywhere goes to the command line, as in AutoCAD.
    if (!inCmd && e.key.length === 1) this.focusCommandLine();
  }

  private recall(step: number): void {
    const n = this.commandRecall.length;
    this.recallIndex = this.recallIndex < 0 ? (step < 0 ? n - 1 : -1) : this.recallIndex + step;
    if (this.recallIndex < 0 || this.recallIndex >= n) {
      this.recallIndex = -1;
      this.cmdText.set('');
    } else {
      this.cmdText.set(this.commandRecall[this.recallIndex]);
    }
    this.cmdInput().nativeElement.value = this.cmdText();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(e: BeforeUnloadEvent): void {
    if (this.engine.dirty()) e.preventDefault();
  }
}
