import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom } from 'rxjs';

import { OrgContextStore } from '../../../core/org/org.stores';
import { RulesApi } from '../../../core/rules/rules-api.service';
import type { RuleCatalogue, RulesView } from '../../../core/rules/rules.models';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { RulesEditorComponent } from './rules-editor.component';
import { RulesSummaryComponent } from './rules-summary.component';
import { RulesTryComponent } from './rules-try.component';

/**
 * The organisation's rules: the fixed checks every layout must pass, with their values. Those
 * with `rules.manage` edit them; everyone else (organisers, their architects) reads them. Both
 * can try them on a hall.
 */
@Component({
  selector: 'app-rules-page',
  imports: [
    DatePipe,
    MatProgressBarModule,
    MatTabsModule,
    PageHeaderComponent,
    RulesEditorComponent,
    RulesSummaryComponent,
    RulesTryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-narrow">
      <app-page-header heading="Rules" [subheading]="subheading()">
        @if (rules(); as r) {
          <span meta class="muted small">Changed {{ r.updatedAt | date: 'd MMM y, HH:mm' }}</span>
        }
      </app-page-header>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (rules(); as r) {
        @if (catalogue(); as c) {
          <mat-tab-group mat-stretch-tabs="false" animationDuration="0ms">
            <mat-tab label="Rules">
              <div class="tab">
                @if (canManage()) {
                  <app-rules-editor [rules]="r" [catalogue]="c" (saved)="rules.set($event)" />
                } @else {
                  <app-rules-summary [rules]="r" [catalogue]="c" />
                }
              </div>
            </mat-tab>
            <mat-tab label="Try on a hall">
              <ng-template matTabContent>
                <div class="tab">
                  <app-rules-try [catalogue]="c" />
                </div>
              </ng-template>
            </mat-tab>
          </mat-tab-group>
        }
      }
    </div>
  `,
  styles: `
    .tab {
      display: grid;
      gap: 16px;
      padding-top: 16px;
    }
    .small {
      font: var(--mat-sys-body-small);
    }
  `,
})
export class RulesPageComponent {
  private readonly api = inject(RulesApi);
  private readonly context = inject(OrgContextStore);

  protected readonly rules = signal<RulesView | null>(null);
  protected readonly catalogue = signal<RuleCatalogue | null>(null);
  protected readonly loading = signal(false);
  protected readonly canManage = computed(() => this.context.can('rules.manage'));
  protected readonly subheading = computed(() =>
    this.canManage()
      ? 'The safety checks every layout must pass. Switch them on or off and set their values.'
      : 'The safety checks every stall you draw must pass. Set by the venue; read only.',
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const slug = this.context.slug();
      const [catalogue, rules] = await Promise.all([
        firstValueFrom(this.api.catalogue(slug)),
        firstValueFrom(this.api.rules(slug)),
      ]);
      this.catalogue.set(catalogue);
      this.rules.set(rules);
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.loading.set(false);
    }
  }
}
