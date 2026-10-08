import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map, startWith } from 'rxjs';

import type { CreatedInvitation, OrganisationView } from '../../../core/api/api.models';
import { AdminApi } from '../../../core/admin/admin-api.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { BrandMarkComponent } from '../../../shared/brand-mark.component';
import { CopyLinkComponent } from '../../../shared/copy-link.component';
import { PageHeaderComponent } from '../../../shared/page-header.component';
import { planForm, PlanFieldsComponent, slugAvailable, slugify, SLUG_PATTERN } from './plan-fields';

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#1f5fbf';

/**
 * A new organisation and the invitation of its first Venue Admin, in one step. The preview
 * beside the form shows its sign-in page in the colour being chosen.
 */
@Component({
  selector: 'app-organisation-create-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    BrandMarkComponent,
    CopyLinkComponent,
    PageHeaderComponent,
    PlanFieldsComponent,
  ],
  templateUrl: './organisation-create-page.component.html',
  styleUrl: './organisation-create-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganisationCreatePageComponent {
  private readonly api = inject(AdminApi);
  private readonly theme = inject(ThemeService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly origin = inject(DOCUMENT).location.origin;
  protected readonly plan = planForm(this.fb);
  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(160)]],
    slug: ['', [Validators.required, Validators.pattern(SLUG_PATTERN)], [slugAvailable(this.api)]],
    primaryColor: [DEFAULT_COLOR, [Validators.required, Validators.pattern(HEX)]],
    adminEmail: ['', [Validators.required, Validators.email]],
    plan: this.plan,
  });
  protected readonly saving = signal(false);
  protected readonly created = signal<{
    organisation: OrganisationView;
    invitation: CreatedInvitation;
  } | null>(null);

  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(this.form.value)), {
    requireSync: true,
  });
  /** The picker shows the hex field's colour while it is valid. */
  protected readonly pickerColor = toSignal(
    this.form.controls.primaryColor.valueChanges.pipe(
      startWith(this.form.controls.primaryColor.value),
      map((value) => (HEX.test(value) ? value.toLowerCase() : DEFAULT_COLOR)),
    ),
    { requireSync: true },
  );
  protected readonly previewName = () => this.value().name?.trim() || 'New organisation';
  protected readonly previewSlug = () => this.value().slug || 'your-link';

  private readonly preview = viewChild<ElementRef<HTMLElement>>('preview');

  constructor() {
    // The link follows the name until it is edited by hand.
    this.form.controls.name.valueChanges
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((name) => {
        if (!this.form.controls.slug.dirty) {
          this.form.controls.slug.setValue(slugify(name));
        }
      });

    effect(() => {
      const element = this.preview()?.nativeElement;
      if (element) {
        this.theme.applyTo(element, {
          primaryColor: this.pickerColor(),
          accentColor: null,
          fontFamily: 'Inter',
        });
      }
    });
  }

  protected pickColor(event: Event): void {
    this.form.controls.primaryColor.setValue((event.target as HTMLInputElement).value);
    this.form.controls.primaryColor.markAsDirty();
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.form.pending) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    try {
      this.created.set(
        await firstValueFrom(
          this.api.createOrganisation({
            name: value.name.trim(),
            slug: value.slug,
            primaryColor: value.primaryColor.toLowerCase(),
            firstAdmin: { email: value.adminEmail.trim() },
            ...value.plan,
          }),
        ),
      );
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.saving.set(false);
    }
  }
}
