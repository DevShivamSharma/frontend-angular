import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { RouterLink } from '@angular/router';

import type { AdminOverview } from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { auditIcon, auditIsWarning, auditLabel } from '../../../shared/audit-labels';
import { BrandMarkComponent } from '../../../shared/brand-mark.component';
import { EmptyStateComponent } from '../../../shared/empty-state.component';
import { StatTileComponent } from '../../../shared/stat-tile.component';
import { TimeAgoPipe } from '../../../shared/time-ago.pipe';

/** The console's home: how the platform stands, what needs a look, and what just happened. */
@Component({
  selector: 'app-admin-overview-page',
  imports: [
    DatePipe,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    TooltipModule,
    BrandMarkComponent,
    EmptyStateComponent,
    StatTileComponent,
    TimeAgoPipe,
  ],
  templateUrl: './admin-overview-page.component.html',
  styleUrl: './admin-overview-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOverviewPageComponent {
  private readonly api = inject(AdminApi);
  private readonly user = inject(AuthService).user;

  protected readonly overview = signal<AdminOverview | null>(null);
  protected readonly today = new Date();
  protected readonly label = auditLabel;
  protected readonly icon = auditIcon;
  protected readonly warning = auditIsWarning;

  protected readonly greeting = computed(() => {
    const hour = this.today.getHours();
    const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = this.user()?.name.split(' ')[0];
    return name ? `${part}, ${name}` : part;
  });

  constructor() {
    this.api.overview().subscribe({
      next: (overview) => this.overview.set(overview),
      error: () => undefined, // The error interceptor has shown it.
    });
  }
}
