import { DatePipe, DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

import { stallLabel } from '../../domain/plan.models';
import { forSale, rupees } from '../../domain/stall-price';
import { firstValueFrom } from 'rxjs';

import { AppDialog } from '../../../../core/dialog/app-dialog.service';
import { ConfirmService } from '../../../../core/confirm/confirm.service';
import {
  RejectDialogComponent,
  RejectDialogData,
  RejectDialogResult,
} from '../reject-dialog/reject-dialog.component';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { PlannerCanvasComponent, PlannerTool } from '../planner-canvas/planner-canvas.component';
import { PlannerStore } from '../../state/planner.store';
import { stallArea } from '../../domain/stall-cells';

/** The tools a reviewer has: they look and measure, and change nothing. */
const TOOLS: Array<{ id: PlannerTool; label: string; icon: string }> = [
  { id: 'select', label: 'Select a stall', icon: 'near_me' },
  { id: 'measure-distance', label: 'Measure a distance', icon: 'measure' },
  { id: 'measure-area', label: 'Measure an area', icon: 'area' },
];

/**
 * The venue's review of an external event's stall plan: the organiser's saved plan, in 3D and
 * 2D, to look at and measure; what it holds, whether it keeps the hall's rules, and Approve or
 * Send back when it waits for approval. Nothing on it changes the plan.
 */
@Component({
  selector: 'app-plan-review',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    TooltipModule,
    IconComponent,
    PlannerCanvasComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-review.component.html',
  styleUrl: './plan-review.component.scss',
})
export class PlanReviewComponent {
  protected readonly stallArea = stallArea;
  protected readonly rupees = rupees;
  protected readonly store = inject(PlannerStore);
  private readonly confirm = inject(ConfirmService);
  private readonly dialog = inject(AppDialog);
  protected readonly canvas = viewChild<PlannerCanvasComponent>('canvas');

  readonly categoryColors = input<ReadonlyMap<string, string>>(new Map());

  protected readonly tools = TOOLS;
  protected readonly tool = signal<PlannerTool>('select');
  protected readonly showLabels = signal(true);
  protected readonly showGrid = signal(false);

  protected readonly back = computed(() => {
    const v = this.store.view();
    return v ? ['/external-events', v.hall.event.id] : ['/external-events'];
  });
  protected readonly organiser = computed(
    () => this.store.view()?.hall.event.organiserName ?? 'The organiser',
  );
  protected readonly breaks = computed(() => this.store.view()?.findings ?? []);

  /** Where the plan stands, in a word and a colour. */
  protected readonly status = computed(() => {
    const v = this.store.view();
    const r = v?.plan.review;
    if (!v?.plan.revision) return { label: 'Not drawn yet', icon: 'hourglass_empty', tone: '' };
    if (r?.status === 'submitted')
      return {
        label: `Waiting for approval · v${r.revision}`,
        icon: 'hourglass_empty',
        tone: 'wait',
      };
    if (r?.status === 'approved')
      return { label: `Approved · v${r.revision}`, icon: 'check_circle', tone: 'good' };
    if (r?.status === 'rejected')
      return { label: `Sent back · v${r.revision}`, icon: 'warning', tone: 'bad' };
    return { label: 'Not sent for approval yet', icon: 'edit', tone: '' };
  });

  protected readonly summary = computed(() => {
    const p = this.store.plan();
    const open = p.stalls.filter((s) => !s.isBlocked);
    return {
      stalls: p.stalls.length,
      forSale: open.filter((s) => s.isActive).length,
      area: open.reduce((sum, s) => sum + stallArea(s), 0),
      premium: p.stalls.filter((s) => s.isPremium).length,
      corner: p.stalls.filter((s) => s.openSides.length >= 2).length,
      blocked: p.stalls.length - open.length,
      zones: p.zones.length,
      seats: p.seats.length,
    };
  });

  /** The stall clicked on the plan, in words. */
  protected readonly picked = computed(() => {
    const s = this.store.selectedStalls()[0];
    if (!s) return null;
    const names = this.store.categoryName();
    const price = this.store.prices().get(s.id) ?? null;
    const flags = [
      s.isPremium && 'premium',
      s.isBlocked && 'blocked',
      s.isFnb && 'food & beverage',
      s.isBranding && 'branding',
      s.isMarqueeAvailable && 'marquee',
      !s.isActive && 'not for sale',
    ].filter(Boolean);
    return {
      label: stallLabel(s),
      price: price
        ? `₹${price.price.toLocaleString('en-IN')}`
        : forSale(s)
          ? 'none'
          : 'not for sale',
      reckoning: price?.reckoning ?? '',
      width: s.width,
      depth: s.depth,
      area: stallArea(s),
      sides: s.openSides.length ? s.openSides.join(', ') : 'none',
      categories: s.categoryIds.map((id) => names.get(id) ?? '?').join(', '),
      flags: flags.join(', '),
    };
  });

  constructor() {
    // The organiser's plan opens in 3D: the hall as visitors will walk it. 2D is a click away.
    afterNextRender(() => {
      if (this.store.view()?.plan.revision) this.canvas()?.enter3d();
    });
  }

  /** A broken rule's stalls, picked on the plan in 2D. */
  protected show(ids: string[]): void {
    if (this.canvas()?.is3d()) this.canvas()?.leave3d();
    this.tool.set('select');
    if (ids.length) this.store.select({ kind: 'stall', ids });
  }

  protected async approve(): Promise<void> {
    const r = this.store.view()?.plan.review;
    const ok = await this.confirm.confirm({
      title: 'Approve the stall plan?',
      message: `Version ${r?.revision} is approved. ${r?.submittedBy ?? 'The organiser'} gets an email and publishes it from the planner.`,
      confirmLabel: 'Approve',
    });
    if (ok) await this.store.review('approve');
  }

  protected async sendBack(): Promise<void> {
    const v = this.store.view();
    const sent = await firstValueFrom(
      this.dialog.open<RejectDialogResult>(RejectDialogComponent, {
        data: { hallName: v?.hall.hall.name ?? 'the plan' } satisfies RejectDialogData,
        width: 'min(560px, 96vw)',
      }),
      { defaultValue: undefined },
    );
    if (sent) await this.store.review('reject', sent.note, sent.files);
  }

  /** ITPO reopens an approved plan, so the organiser can change it. */
  protected async reopen(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Reopen the plan?',
      message:
        'The plan is reopened. The organiser is told, can change the plan and must send it for approval again.',
      confirmLabel: 'Reopen',
    });
    if (ok) await this.store.review('reopen');
  }
}
