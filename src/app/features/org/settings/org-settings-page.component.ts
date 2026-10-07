import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';

import type { ConfigVersion, OrganisationConfig, OrgSettings } from '../../../core/api/api.models';
import { OrgApi } from '../../../core/org/org-api.service';
import { OrgContextStore, PublicOrgStore } from '../../../core/org/org.stores';
import { ThemeService } from '../../../core/theme/theme.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { ConfigFormComponent } from '../../../shared/config-form/config-form.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';

/** The organisation's look and paperwork. Every save is a version that can be restored. */
@Component({
  selector: 'app-org-settings-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatProgressBarModule,
    ConfigFormComponent,
    PageHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <app-page-header
        heading="Settings"
        [subheading]="
          canManage()
            ? 'Changes apply to everyone as soon as they are saved.'
            : 'Only a member who can change settings can edit these.'
        "
      />
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      @if (settings(); as s) {
        <app-config-form
          [config]="s.config"
          [organisationName]="context.context()?.organisation?.name ?? ''"
          [readonly]="!canManage()"
          [saving]="busy()"
          (save)="save($event)"
        />
        <mat-card appearance="outlined">
          <mat-card-content>
            <h2 class="section-title">Versions</h2>
            <ul class="versions">
              @for (version of versions(); track version.version) {
                <li>
                  <span class="version">v{{ version.version }}</span>
                  <span
                    class="swatch"
                    [style.background]="version.config.branding.primaryColor"
                    aria-hidden="true"
                  ></span>
                  <span
                    >{{ version.createdAt | date: 'd MMM y, HH:mm' }} ·
                    {{ version.changedBy?.name ?? 'Unknown' }}</span
                  >
                  <span class="spacer"></span>
                  @if (version.current) {
                    <span class="status-chip is-positive">Current</span>
                  } @else if (canManage()) {
                    <button mat-button (click)="restore(version)" [disabled]="busy()">
                      Restore
                    </button>
                  }
                </li>
              }
            </ul>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .versions {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .versions li {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .version {
      font: var(--mat-sys-label-large);
      min-width: 36px;
    }
    .swatch {
      width: 16px;
      height: 16px;
      border-radius: 4px;
    }
  `,
})
export class OrgSettingsPageComponent {
  private readonly api = inject(OrgApi);
  private readonly notifier = inject(Notifier);
  private readonly confirm = inject(ConfirmService);
  private readonly theme = inject(ThemeService);
  private readonly publicOrg = inject(PublicOrgStore);
  protected readonly context = inject(OrgContextStore);

  protected readonly settings = signal<OrgSettings | null>(null);
  protected readonly versions = signal<ConfigVersion[]>([]);
  protected readonly busy = signal(false);
  protected readonly canManage = computed(() => this.context.can('org.settings.manage'));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const slug = this.context.slug();
      const [settings, versions] = await Promise.all([
        firstValueFrom(this.api.settings(slug)),
        firstValueFrom(this.api.configVersions(slug)),
      ]);
      this.settings.set(settings);
      this.versions.set(versions);
    } catch (error) {
      this.notifier.error(error);
    }
  }

  protected async save(config: OrganisationConfig): Promise<void> {
    await this.apply(
      () => firstValueFrom(this.api.saveConfig(this.context.slug(), config)),
      'Saved as a new version.',
    );
  }

  protected async restore(version: ConfigVersion): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Restore version ${version.version}?`,
      message: 'It is saved again as the newest version, and applies to everyone at once.',
      confirmLabel: 'Restore',
    });
    if (confirmed) {
      await this.apply(
        () => firstValueFrom(this.api.restoreConfig(this.context.slug(), version.version)),
        `Version ${version.version} restored.`,
      );
    }
  }

  /** Saves, then re-themes the app at once so the change is visible everywhere. */
  private async apply(change: () => Promise<OrgSettings>, message: string): Promise<void> {
    this.busy.set(true);
    try {
      const saved = await change();
      this.settings.set(saved);
      const current = this.publicOrg.config();
      if (current) {
        this.publicOrg.config.set({
          ...current,
          branding: saved.config.branding,
          locale: {
            defaultLanguage: saved.config.locale.defaultLanguage,
            languages: saved.config.locale.languages,
          },
        });
      }
      this.theme.applyBranding(saved.config.branding);
      this.notifier.success(message);
      this.versions.set(await firstValueFrom(this.api.configVersions(this.context.slug())));
    } catch (error) {
      this.notifier.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
