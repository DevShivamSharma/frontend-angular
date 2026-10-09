import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { IconComponent } from '../../../shared/icon.component';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import {
  BOOKING_MODES,
  type AdminRoleView,
  type ConfigVersion,
  type CreatedInvitation,
  type OrganisationConfig,
  type OrganisationDetail,
} from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { Notifier } from '../../../core/ui/notifier.service';
import { BrandMarkComponent } from '../../../shared/brand-mark.component';
import { ConfigFormComponent } from '../../../shared/config-form/config-form.component';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { planForm, PlanFieldsComponent, slugAvailable, SLUG_PATTERN } from './plan-fields';
import { FieldComponent } from '../../../shared/field.component';
import { InputTextModule } from 'primeng/inputtext';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';

/**
 * One organisation in the console: its status, link, plan, branding and admins. Business data
 * (venues, events, bookings) is deliberately not here.
 */
@Component({
  selector: 'app-organisation-detail-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    ButtonModule,
    IconComponent,
    ProgressBarModule,
    TooltipModule,
    BrandMarkComponent,
    ConfigFormComponent,
    CopyLinkComponent,
    PlanFieldsComponent,
    FieldComponent,
    InputTextModule,
    InputGroupModule,
    InputGroupAddonModule,
    SelectModule,
    TableModule,
    TabsModule,
  ],
  templateUrl: './organisation-detail-page.component.html',
  styleUrl: './organisation-detail-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganisationDetailPageComponent {
  private readonly api = inject(AdminApi);
  private readonly notifier = inject(Notifier);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly theme = inject(ThemeService);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly origin = inject(DOCUMENT).location.origin;
  protected readonly organisation = signal<OrganisationDetail | null>(null);
  protected readonly versions = signal<ConfigVersion[]>([]);
  protected readonly roles = signal<AdminRoleView[]>([]);
  protected readonly lastInvite = signal<CreatedInvitation | null>(null);
  protected readonly busy = signal(false);

  protected readonly bookingLabel = computed(
    () =>
      BOOKING_MODES.find((mode) => mode.value === this.organisation()?.bookingMode)?.label ?? '',
  );
  private readonly hero = viewChild<ElementRef<HTMLElement>>('hero');
  protected readonly invitableRoles = computed(() =>
    this.roles().filter((role) => role.scopeKind === 'organisation'),
  );

  protected readonly plan = planForm(this.fb);
  protected readonly nameForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
  });
  protected readonly slugForm = this.fb.group({
    slug: [
      '',
      [Validators.required, Validators.pattern(SLUG_PATTERN)],
      [slugAvailable(this.api, () => this.id())],
    ],
  });
  protected readonly inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    roleId: ['', Validators.required],
  });

  constructor() {
    // Only the route inputs restart the load: the request itself reads the session signal.
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // The header shows the organisation in its own colours; the console keeps the platform's.
    effect(() => {
      const element = this.hero()?.nativeElement;
      const branding = this.organisation()?.config.branding;
      if (element && branding) {
        this.theme.applyTo(element, branding);
      }
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const [organisation, versions, roles] = await Promise.all([
        firstValueFrom(this.api.organisation(id)),
        firstValueFrom(this.api.configVersions(id)),
        firstValueFrom(this.api.roles(id)),
      ]);
      this.show(organisation);
      this.versions.set(versions);
      this.roles.set(roles);
      const owner = roles.find((role) => role.isLocked);
      if (owner && !this.inviteForm.controls.roleId.value) {
        this.inviteForm.controls.roleId.setValue(owner.id);
      }
    } catch {
      // The error interceptor has shown it.
    }
  }

  private show(organisation: OrganisationDetail): void {
    this.organisation.set(organisation);
    this.nameForm.reset({ name: organisation.name });
    this.slugForm.reset({ slug: organisation.slug });
    this.plan.reset({
      bookingMode: organisation.bookingMode,
      features: organisation.features,
      limits: organisation.limits,
    });
  }

  protected async savePlan(): Promise<void> {
    if (this.plan.invalid || this.nameForm.invalid) {
      this.plan.markAllAsTouched();
      this.nameForm.markAllAsTouched();
      return;
    }
    await this.run(async () => {
      await firstValueFrom(
        this.api.updateOrganisation(this.id(), {
          name: this.nameForm.getRawValue().name.trim(),
          ...this.plan.getRawValue(),
        }),
      );
      this.notifier.success('Saved.');
    });
  }

  protected async changeSlug(): Promise<void> {
    if (this.slugForm.invalid || this.slugForm.pending) {
      this.slugForm.markAllAsTouched();
      return;
    }
    const slug = this.slugForm.getRawValue().slug;
    const confirmed = await this.confirm.confirm({
      title: 'Change the link?',
      message: `The organisation moves to /${slug}. Links that use /${this.organisation()?.slug} keep working and lead to the new one.`,
      confirmLabel: 'Change the link',
    });
    if (confirmed) {
      await this.run(async () => {
        await firstValueFrom(this.api.changeSlug(this.id(), slug));
        this.notifier.success('Link changed.');
      });
    }
  }

  protected async suspend(): Promise<void> {
    const reason = await this.confirm.askReason({
      title: `Suspend ${this.organisation()?.name}?`,
      message:
        'Its links show the invalid-link page and nobody can sign in to it until it is re-activated. Nothing is deleted.',
      confirmLabel: 'Suspend',
      destructive: true,
      reasonLabel: 'Reason (kept in the audit log)',
    });
    if (reason) {
      await this.run(async () => {
        await firstValueFrom(this.api.suspend(this.id(), reason));
        this.notifier.success('Suspended.');
      });
    }
  }

  protected async activate(): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.activate(this.id()));
      this.notifier.success('Active again.');
    });
  }

  protected async saveConfig(config: OrganisationConfig): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.api.saveConfig(this.id(), config));
      this.notifier.success('Saved as a new version.');
    });
  }

  protected async restore(version: ConfigVersion): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Restore version ${version.version}?`,
      message: 'It is saved again as the newest version. Nothing in the history is lost.',
      confirmLabel: 'Restore',
    });
    if (confirmed) {
      await this.saveConfig(version.config);
    }
  }

  protected async invite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    const { email, roleId } = this.inviteForm.getRawValue();
    await this.run(async () => {
      this.lastInvite.set(await firstValueFrom(this.api.invite(this.id(), email.trim(), roleId)));
      this.inviteForm.controls.email.reset('');
      this.notifier.success(`Invitation created for ${email}.`);
    });
  }

  /** Runs a change, then reloads everything it may have touched. */
  private async run(change: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await change();
      await this.load(this.id());
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
