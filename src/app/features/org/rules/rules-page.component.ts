import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ProgressBarModule } from 'primeng/progressbar';
import { firstValueFrom } from 'rxjs';

import { OrgContextStore } from '../../../core/org/org.stores';
import { RulesApi } from '../../../core/rules/rules-api.service';
import type { RuleCatalogue, RulesView } from '../../../core/rules/rules.models';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { RulesEditorComponent } from './rules-editor.component';
import { RulesSummaryComponent } from './rules-summary.component';
import { RulesTryComponent } from './rules-try.component';
import { TabsModule } from 'primeng/tabs';

/**
 * The organisation's rules: the fixed checks every layout must pass, with their values. Those
 * with `rules.manage` edit them; everyone else (organisers, their architects) reads them. Both
 * can try them on a hall.
 */
@Component({
  selector: 'app-rules-page',
  imports: [
    DatePipe,
    ProgressBarModule,
    PageHeaderComponent,
    RulesEditorComponent,
    RulesSummaryComponent,
    RulesTryComponent,
    TabsModule,
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
        <p-progressbar mode="indeterminate" />
      }
      @if (rules(); as r) {
        @if (catalogue(); as c) {
          <p-tabs [value]="tab()" (valueChange)="tab.set($any($event))">
            <p-tablist>
              <p-tab value="rules">Rules</p-tab>
              <p-tab value="try">Try on a hall</p-tab>
            </p-tablist>
            <p-tabpanels>
              <p-tabpanel value="rules">
                <div class="tab">
                  @if (canManage()) {
                    <app-rules-editor [rules]="r" [catalogue]="c" (saved)="rules.set($event)" />
                  } @else {
                    <app-rules-summary [rules]="r" [catalogue]="c" />
                  }
                </div>
              </p-tabpanel>
              <p-tabpanel value="try">
                <!-- Created on opening, so each visit starts a fresh check. -->
                @if (tab() === 'try') {
                  <div class="tab">
                    <app-rules-try [catalogue]="c" />
                  </div>
                }
              </p-tabpanel>
            </p-tabpanels>
          </p-tabs>
        }
      }
    </div>
  `,
  styles: `
    .tab {
      display: grid;
      gap: 16px;
    }
    p-tabpanels {
      padding: 16px 0 0;
      background: transparent;
    }
    .small {
      font: var(--app-body-small);
    }
  `,
})
export class RulesPageComponent {
  private readonly api = inject(RulesApi);
  private readonly context = inject(OrgContextStore);

  protected readonly rules = signal<RulesView | null>(null);
  protected readonly catalogue = signal<RuleCatalogue | null>(null);
  protected readonly loading = signal(false);
  protected readonly tab = signal<'rules' | 'try'>('rules');
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
