import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { extractErrorMessage } from '../core/http-error.util';
import { NotifyService } from '../core/notify.service';
import type { Hall } from '../planner/models/hall.model';
import { RuleDialogComponent } from './rule-dialog.component';
import { SetupApiService } from './setup-api.service';
import { SetupState } from './setup-state.service';
import type { PlannerRule } from './setup.models';

/**
 * Step 2: the shared library of plotting rules. Rules are free text, stored in the database and
 * not tied to halls; the planner chooses which apply when a layout's design starts. The chosen
 * hall (`?hall=<id>`) is only carried through to the stall editor.
 */
@Component({
  selector: 'app-rules-page',
  imports: [RouterLink, RuleDialogComponent],
  templateUrl: './rules-page.component.html',
  styleUrl: './rules-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RulesPageComponent implements OnInit {
  private readonly api = inject(SetupApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  private readonly state = inject(SetupState);
  private readonly dialog = viewChild.required(RuleDialogComponent);

  readonly hallId = signal<string | null>(null);
  readonly halls = signal<Hall[]>([]);
  readonly rules = signal<PlannerRule[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly error = signal('');
  readonly expanded = signal<Set<number>>(new Set());

  readonly hall = computed(() => this.halls().find(h => String(h.id) === this.hallId()) ?? null);

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('hall') ?? this.state.hallId();
    if (!id) {
      void this.router.navigate(['/planner/halls']);
      return;
    }
    this.hallId.set(id);
    this.state.select(id);
    void this.load();
  }

  async load(): Promise<void> {
    this.status.set('loading');
    try {
      const [halls, rules] = await Promise.all([this.api.listHalls(), this.api.listRules()]);
      this.halls.set([...halls].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      this.rules.set(rules);
      if (!this.hall()) {
        this.state.select(null);
        this.notify.error('That hall no longer exists', 'Choose a hall again.');
        void this.router.navigate(['/planner/halls']);
        return;
      }
      this.status.set('ready');
    } catch (e) {
      this.error.set(extractErrorMessage(e));
      this.status.set('error');
    }
  }

  add(): void {
    this.dialog().open(null);
  }

  edit(rule: PlannerRule): void {
    this.dialog().open(rule);
  }

  onSaved(rule: PlannerRule): void {
    const exists = this.rules().some(r => r.id === rule.id);
    this.rules.update(list => (exists ? list.map(r => (r.id === rule.id ? rule : r)) : [...list, rule]));
    this.notify.success(exists ? 'Rule updated' : 'Rule added');
  }

  async remove(rule: PlannerRule): Promise<void> {
    const confirmed = await this.notify.confirm({
      title: 'Delete this rule?',
      text: 'It will no longer be offered in the stall editor, and layouts that applied it will no longer list it. This cannot be undone.',
      confirmText: 'Delete',
      danger: true
    });
    if (!confirmed) return;
    try {
      await this.api.deleteRule(rule.id);
      this.rules.update(list => list.filter(r => r.id !== rule.id));
      this.notify.success('Rule deleted');
    } catch (e) {
      this.notify.error('The rule could not be deleted', extractErrorMessage(e));
    }
  }

  toggleExpanded(id: number): void {
    this.expanded.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  isLong(rule: PlannerRule): boolean {
    return rule.description.length > 280 || rule.description.split('\n').length > 4;
  }

  updated(rule: PlannerRule): string {
    return relative(new Date(rule.updatedAt));
  }

  /** Step 3: the drafting workspace, opened on the chosen hall. */
  startCreating(): void {
    void this.router.navigate(['/planner/draft'], { queryParams: { hallId: this.hallId() } });
  }

  /** The 3D planner on the same hall, for those who prefer placing stalls there. */
  open3d(): void {
    void this.router.navigate(['/planner/editor'], { queryParams: { hallId: this.hallId() } });
  }
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function relative(date: Date): string {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
