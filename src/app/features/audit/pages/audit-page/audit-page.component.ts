import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { Subscription, debounceTime } from 'rxjs';

import { NotifierService } from '../../../../core/notification/notifier.service';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { TableSkeletonComponent } from '../../../../shared/ui/table-skeleton/table-skeleton.component';
import { AuditApiService, AuditEntry } from '../../data/audit-api.service';

const PAGE_SIZE = 20;

const day = (d: Date | null) => {
  if (!d) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Who did what and when: plans, rates and rules. ITPO staff read it; it filters by event, user, action and day. */
@Component({
  selector: 'app-audit-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonModule,
    DatePickerModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    PaginatorModule,
    SelectModule,
    EmptyStateComponent,
    PageHeaderComponent,
    TableSkeletonComponent,
  ],
  templateUrl: './audit-page.component.html',
  styleUrl: './audit-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPageComponent {
  private readonly api = inject(AuditApiService);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly filters = new FormGroup({
    event: new FormControl('', { nonNullable: true }),
    user: new FormControl('', { nonNullable: true }),
    action: new FormControl<string | null>(null),
    from: new FormControl<Date | null>(null),
    to: new FormControl<Date | null>(null),
  });
  protected readonly actions = signal<Array<{ id: string; label: string }>>([]);
  protected readonly items = signal<AuditEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly first = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  /** Some filter is set: Clear is offered. */
  protected readonly filtered = signal(false);
  protected readonly skeleton = [
    { width: '6rem' },
    { width: '8rem' },
    { width: '10rem' },
    { width: '12rem', hideSmall: true },
    { width: '4rem', hideSmall: true },
    { width: '14rem', hideSmall: true },
  ];
  private request: Subscription | null = null;

  constructor() {
    this.api
      .actions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (a) => this.actions.set(a), error: () => undefined });
    this.filters.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((f) => {
        this.filtered.set(!!(f.event || f.user || f.action || f.from || f.to));
        this.fetch(0);
      });
    this.fetch(0);
  }

  protected onPage(event: PaginatorState): void {
    this.fetch(event.first ?? 0);
  }

  protected clear(): void {
    this.filters.reset({ event: '', user: '', action: null, from: null, to: null });
  }

  protected retry(): void {
    this.fetch(this.first());
  }

  protected initials(name: string | null): string {
    const words = (name ?? '').split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
  }

  /** The detail as its parts, `key: value` pairs where it has them ("PASSAGE: off, openSideAccess: on"). */
  protected detailParts(detail: string | null): Array<{ key: string; value: string | null }> {
    if (!detail?.trim()) return [];
    return detail.split(', ').map((part) => {
      const at = part.indexOf(': ');
      return at > 0
        ? { key: part.slice(0, at), value: part.slice(at + 2) }
        : { key: part, value: null };
    });
  }

  protected actionLabel(id: string): string {
    return this.actions().find((a) => a.id === id)?.label ?? id;
  }

  private fetch(first: number): void {
    this.request?.unsubscribe();
    this.first.set(first);
    this.loading.set(true);
    this.failed.set(false);
    const f = this.filters.getRawValue();
    this.request = this.api
      .list({
        page: Math.floor(first / PAGE_SIZE) + 1,
        size: PAGE_SIZE,
        action: f.action ?? undefined,
        event: f.event.trim() || undefined,
        user: f.user.trim() || undefined,
        from: day(f.from),
        to: day(f.to),
      })
      .subscribe({
        next: (page) => {
          this.items.set(page.items);
          this.total.set(page.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.items.set([]);
          this.notifier.fromError(error, 'The audit trail could not be loaded');
        },
      });
  }
}
