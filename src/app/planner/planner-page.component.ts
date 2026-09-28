import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { findVenueHall } from '../shared/hall-identity';
import { NotifyService } from '../core/notify.service';

import { PlannerTourComponent, PlannerTourStep } from './components/planner-tour.component';
import { PlannerTourState } from './components/planner-tour-state.service';
import { AddStallFormComponent } from './components/add-stall-form.component';
import { CreateHallFormComponent } from './components/create-hall-form.component';
import { EditStallFormComponent } from './components/edit-stall-form.component';
import { EditorToolbarComponent } from './components/editor-toolbar.component';
import { openSidesLabel } from './components/gate-sides';
import { IconComponent, IconName } from './components/icon.component';
import { SavedLayoutsPanelComponent } from './components/saved-layouts-panel.component';
import { SelfcareImportComponent } from './components/selfcare-import.component';
import { ShopsListComponent } from './components/shops-list.component';
import { ViolationsPanelComponent } from './components/violations-panel.component';
import { WorkingHallPanelComponent } from './components/working-hall-panel.component';
import { AssistPanelComponent } from './components/assist-panel.component';
import { PlannerRulesDialogComponent } from './components/planner-rules-dialog.component';
import { AiChatLauncherComponent } from './components/ai-chat-launcher.component';
import { AiChatSession } from './ai-chat-session.service';
import { legendEntries } from './geometry/legend-content';
import { PlannerStore } from './planner-store.service';
import { Scene3dComponent, StallMove, StallOpenSide, ViewCommand } from './three/scene3d.component';

/** Sidebar sections. UI only: which group of panels is visible. */
export type SidebarTab = 'stalls' | 'assist' | 'layouts' | 'hall' | 'rules';

interface SidebarTabView {
  id: SidebarTab;
  label: string;
  icon: IconName;
  count: number | null;
  /** Highlight the count (rule problems). */
  warn: boolean;
}

const TAB_ORDER: readonly SidebarTab[] = ['stalls', 'assist', 'layouts', 'hall', 'rules'];

/** Same breakpoint as the stacked layout in planner-page.component.css. */
const COMPACT_QUERY = '(max-width: 900px)';

/** The notification draws its own icon. */
const LEADING_EMOJI = /^(?:❌|⚠️?)\s*/;

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
  providers: [PlannerStore, AiChatSession],
  imports: [
    PlannerTourComponent,
    SelfcareImportComponent,
    WorkingHallPanelComponent,
    CreateHallFormComponent,
    AddStallFormComponent,
    AssistPanelComponent,
    PlannerRulesDialogComponent,
    AiChatLauncherComponent,
    EditStallFormComponent,
    ShopsListComponent,
    SavedLayoutsPanelComponent,
    Scene3dComponent,
    EditorToolbarComponent,
    ViolationsPanelComponent,
    IconComponent,
    RouterLink
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlannerPageComponent implements OnInit {
  /** Public so the template can hand the draw-mode pointer events straight to the store. */
  readonly store = inject(PlannerStore);
  private readonly notify = inject(NotifyService);
  private readonly venueParams = toSignal(inject(ActivatedRoute).queryParamMap);
  private appliedVenueRequest: string | undefined;

  readonly error = this.store.error;
  readonly stalls = this.store.stalls;
  readonly currentHall = this.store.currentHall;
  /** The current hall's plan legend, in view mode (rows hidden in view mode left out). */
  readonly planLegend = computed(() => legendEntries(this.currentHall()?.legends));
  readonly currentStalls = this.store.currentStalls;
  readonly selectedStall = this.store.selectedStall;
  readonly selectedStallId = this.store.selectedStallId;
  readonly dragging = this.store.dragging;
  readonly snap = this.store.snap;
  readonly mode = this.store.mode;
  readonly overlay = this.store.overlay;
  readonly showClearances = this.store.showClearances;
  readonly eventType = this.store.eventType;
  readonly focusTarget = this.store.focusTarget;
  readonly grid = this.store.grid;
  readonly ruleDriven = this.store.ruleDriven;
  readonly layoutName = this.store.layoutName;
  readonly selectedSavedId = this.store.selectedSavedId;
  readonly hallsStatus = this.store.hallsStatus;

  readonly openSidesLabel = openSidesLabel;

  readonly activeTab = signal<SidebarTab>('stalls');
  readonly saving = signal(false);
  private readonly tourPreference = inject(PlannerTourState);
  private autoTourOffered = false;
  private tourReturnState: { sidebar: boolean; tab: SidebarTab; info: boolean } | null = null;
  readonly rulesDismissed = signal(false);
  readonly tourIndex = signal<number | null>(null);
  readonly tourCardHeight = signal(244);
  readonly tourSteps = computed<PlannerTourStep[]>(() => [
    {
      id: 'hall', title: 'Choose a hall', targets: ['#working-hall'],
      message: 'Choose the hall or floor you want to work on. Search by name to find it quickly.'
    },
    {
      id: 'stall', title: 'Select or add a stall', targets: ['[data-tour="add-stall"]'],
      message: 'Select a stall on the grid, or enter a name and size, then click Add Shop to place a new stall.'
    },
    {
      id: 'position', title: 'Drag to position your stall', targets: ['[data-tour="position"]'],
      message: 'In Select mode, drag a stall to move it on the grid. On mobile, touch and drag. Keep passages and wall clearances free.'
    },
    {
      id: 'details', title: 'Review stall details',
      targets: ['[data-tour="stall-details"]', '[data-tour="stall-size"]'],
      message: this.selectedStall()
        ? 'Review the selected stall name, size and status. Check its position and open sides, then click Apply Shop Changes.'
        : 'Check the stall size here. Add or select a stall to edit its details, position and open sides.'
    },
    {
      id: 'save', title: 'Save your layout', targets: ['[data-tour="save-layout"]'],
      message: this.offline()
        ? 'You are using an offline sample. Connect to the server before saving your layout.'
        : 'When your layout is ready, click Save layout or Save changes. Resolve any issues in the Rules tab. Use Help to replay this tour.'
    }
  ]);
  readonly tourStep = computed(() => {
    const index = this.tourIndex();
    return index === null ? null : this.tourSteps()[index];
  });

  /** The sidebar can be hidden so the 3D view gets the full width. UI only. */
  readonly sidebarOpen = signal(true);

  /**
   * The Hall details panel over the stage. Starts collapsed on narrow screens, where it would
   * otherwise cover most of the 3D view.
   */
  readonly hallInfoOpen = signal(!window.matchMedia(COMPACT_QUERY).matches);

  /** Offline fallback in use: the server did not answer, or has no halls. */
  readonly offline = computed(() => {
    const status = this.hallsStatus();
    return status === 'unavailable' || status === 'empty';
  });

  /** A polygon outline is neither of the two form shapes, so it gets its own name. */
  readonly shapeLabel = computed(() => {
    const hall = this.currentHall();
    if (!hall) return '';
    if (hall.boundary && hall.boundary.length >= 3) return 'Irregular outline';
    return hall.shape === 'CIRCLE' ? 'Circular' : 'Rectangular';
  });

  private readonly sidebarBody = viewChild<ElementRef<HTMLElement>>('sidebarBody');
  private readonly collapseButton = viewChild<ElementRef<HTMLButtonElement>>('collapseButton');
  private readonly expandButton = viewChild<ElementRef<HTMLButtonElement>>('expandButton');
  private readonly injector = inject(Injector);

  readonly tabs = computed<SidebarTabView[]>(() => {
    const issues = this.issueCount();
    // A badge reading "0" is noise on every tab of an empty hall: no badge says the same thing.
    const badge = (n: number) => (n > 0 ? n : null);

    return [
      { id: 'stalls', label: 'Stalls', icon: 'store', count: badge(this.currentStalls().length), warn: false },
      { id: 'assist', label: 'Assist', icon: 'sparkles', count: null, warn: false },
      { id: 'layouts', label: 'Layouts', icon: 'save', count: badge(this.store.savedLayouts().length), warn: false },
      { id: 'hall', label: 'Hall', icon: 'building', count: null, warn: false },
      { id: 'rules', label: 'Rules', icon: 'shield', count: this.ruleDriven() ? badge(issues) : null, warn: issues > 0 }
    ];
  });

  private readonly issueCount = computed(() =>
    this.store.audit().reduce((n, e) => n + e.violations.length, 0)
  );

  /**
   * The header totals. Cancelled stalls keep their number but free their area, so they count
   * as shops and not as occupied floor.
   */
  readonly stats = computed(() => {
    const hall = this.currentHall();
    const used = this.store
      .activeStalls()
      .reduce((total, stall) => total + stall.width * stall.length, 0);
    const floor = hall
      ? hall.shape === 'CIRCLE'
        ? Math.PI * hall.radius * hall.radius
        : hall.width * hall.length
      : 0;

    return {
      shops: this.currentStalls().length,
      area: Math.round(used),
      occupancy: floor > 0 ? Math.round((used / floor) * 100) : 0,
      issues: this.ruleDriven() ? this.issueCount() : 0
    };
  });

  /** Latest view-dock command. The counter makes pressing the same button twice take effect. */
  readonly viewCommand = signal<ViewCommand | null>(null);

  constructor() {
    effect(() => {
      const ready = this.hallsStatus() !== 'loading';
      if (!ready || !this.rulesDismissed() || this.autoTourOffered) return;
      this.autoTourOffered = true;
      if (!this.tourPreference.hasSeen()) untracked(() => this.startTour());
    });
    // Wait for real halls before resolving a venue deep link. Consume it once so later
    // hall changes and retries never pull the visitor away from their current work.
    effect(() => {
      const params = this.venueParams(), number = params?.get('hall');
      if (!number) { this.appliedVenueRequest = undefined; return; }
      if (this.hallsStatus() !== 'ready') return;
      const floor = params?.get('floor') ?? null;
      const request = JSON.stringify([number, floor]);
      if (this.appliedVenueRequest === request) return;
      const hall = findVenueHall(this.store.halls(), number, floor);
      this.appliedVenueRequest = request;
      untracked(() => {
        if (hall) this.store.setActiveHall(hall.id);
        else {
          this.activeTab.set('hall');
          this.notify.error('Hall unavailable', 'This hall or floor is not available in the planner. Choose a hall from the Hall tab.');
        }
      });
    });

    // One shared toast surface; detailed placement diagnostics stay in the Rules panel.
    effect(() => {
      const message = this.error().replace(LEADING_EMOJI, '');
      if (!message) return;
      untracked(() => {
        const parts = message.match(/^([^:]+):\s+([\s\S]+)$/);
        const hasDetails = !!this.store.rejection() || this.store.serverViolations().length > 0;
        this.notify.error(parts?.[1] ?? 'Not allowed', parts?.[2] ?? message,
          hasDetails ? () => this.showFeedbackDetails() : undefined);
      });
    });

    // Selecting a stall (in the list or the 3D view) brings its editor into view: the Stalls
    // tab, scrolled to the top where the editor sits.
    effect(() => {
      if (this.selectedStallId() === null) return;
      this.activeTab.set('stalls');
      this.sidebarBody()?.nativeElement.scrollTo({ top: 0 });
    });

    // Every tab opens at its top, not at the previous tab's scroll position.
    effect(() => {
      this.activeTab();
      this.sidebarBody()?.nativeElement.scrollTo({ top: 0 });
    });
  }

  /** Keep the current layout's save action available while editing any panel. */
  async saveCurrentLayout(): Promise<void> {
    if (this.store.busy() || !this.currentHall()) return;
    this.saving.set(true);
    try {
      if (this.selectedSavedId() === null) await this.store.saveLayout();
      else await this.store.updateLayout();
    } finally {
      this.saving.set(false);
    }
  }

  startTour(): void {
    if (this.tourIndex() !== null) return;
    this.autoTourOffered = true;
    this.tourReturnState = {
      sidebar: this.sidebarOpen(), tab: this.activeTab(), info: this.hallInfoOpen()
    };
    this.moveTour(0);
  }

  moveTour(index: number): void {
    if (index < 0 || index >= this.tourSteps().length) return;
    this.sidebarOpen.set(true);
    this.activeTab.set('stalls');
    this.hallInfoOpen.set(false);
    this.tourIndex.set(index);
  }

  endTour(outcome: 'completed' | 'skipped'): void {
    this.tourPreference.remember(outcome);
    this.tourIndex.set(null);
    if (this.tourReturnState) {
      this.sidebarOpen.set(this.tourReturnState.sidebar);
      this.activeTab.set(this.tourReturnState.tab);
      this.hallInfoOpen.set(this.tourReturnState.info);
      this.tourReturnState = null;
    }
    afterNextRender(() => {
      const selector = this.sidebarOpen() ? '.sidebar .planner-tour-help' : '.stage-top .planner-tour-help';
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  setTab(tab: SidebarTab): void {
    this.activeTab.set(tab);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(open => !open);

    // The button just pressed is now hidden (inert, or removed by @if), which would drop keyboard
    // focus to <body>. Hand it to the other toggle once that one has rendered.
    afterNextRender(
      () => (this.sidebarOpen() ? this.collapseButton() : this.expandButton())?.nativeElement.focus(),
      { injector: this.injector }
    );
  }

  /** WAI-ARIA tabs keyboard pattern: arrows, Home and End move between tabs. */
  onTabKey(event: KeyboardEvent): void {
    const index = TAB_ORDER.indexOf(this.activeTab());
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TAB_ORDER.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TAB_ORDER.length) % TAB_ORDER.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TAB_ORDER.length - 1
              : -1;
    if (next < 0) return;

    event.preventDefault();
    this.activeTab.set(TAB_ORDER[next]);
    document.getElementById(`sidebar-tab-${TAB_ORDER[next]}`)?.focus();
  }

  ngOnInit(): void {
    this.loadFromServer();
  }

  /** Retry from the offline notice: everything the planner fetches on mount. */
  loadFromServer(): void {
    // Real halls first, so the planner opens on an actual ITPO hall rather than the
    // offline fallback. Independent of the layout list, so they run concurrently.
    void this.store.loadHalls();

    // App.js:500 - the saved layout list is fetched once on mount.
    void this.store.loadList();

    // Stall sizes for draw mode are backend configuration.
    void this.store.loadStallTypes();
  }

  private showFeedbackDetails(): void {
    this.sidebarOpen.set(true);
    this.activeTab.set('rules');
    afterNextRender(() => {
      document.getElementById('sidebar-tab-rules')?.focus();
      this.sidebarBody()?.nativeElement.scrollTo({ top: 0 });
    }, { injector: this.injector });
  }

  setView(kind: ViewCommand['kind']): void {
    this.viewCommand.update(previous => ({ kind, seq: (previous?.seq ?? 0) + 1 }));
  }

  onHallInfoToggle(event: Event): void {
    this.hallInfoOpen.set((event.target as HTMLDetailsElement).open);
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

  /** Wall click in the 3D view: opens that side (closing happens via the sidebar toggles). */
  onOpenSideChange(event: StallOpenSide): void {
    this.store.openSide(event.id, event.side);
  }
}
