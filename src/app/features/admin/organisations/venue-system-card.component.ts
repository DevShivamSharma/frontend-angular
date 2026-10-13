import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { firstValueFrom } from 'rxjs';

import { AdminApi } from '../../../core/admin/admin-api.service';
import type { VenueIntegration } from '../../../core/api/api.models';
import { Notifier } from '../../../core/ui/notifier.service';
import { FieldComponent } from '../../../shared/field.component';

/** Links an organisation to its venue system: where published plans of internal events go. */
@Component({
  selector: 'app-venue-system-card',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    FieldComponent,
    InputTextModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <form [formGroup]="form" (ngSubmit)="save()">
        <div class="card-body">
          <h2 class="section-title">Venue system</h2>
          <p class="muted">
            Where published stall plans of internal events are sent (ITPO SelfCare). The secret is
            write-only.
          </p>
          <app-field
            label="Callback URL"
            error="A full address, starting with https://"
            for="venue-system-url"
          >
            <input
              id="venue-system-url"
              pInputText
              formControlName="callbackUrl"
              maxlength="500"
              autocomplete="off"
            />
          </app-field>
          <app-field label="Shared secret" error="16 to 256 characters" for="venue-system-secret">
            <input
              id="venue-system-secret"
              type="password"
              pInputText
              formControlName="secret"
              autocomplete="new-password"
              [placeholder]="
                link()?.configured
                  ? 'Set (…' + link()?.secretHint + '). Leave empty to keep it.'
                  : 'The secret ITPO gave you'
              "
            />
          </app-field>
          <label class="enabled">
            <p-checkbox [binary]="true" formControlName="enabled" inputId="venue-system-enabled" />
            Send published plans
          </label>
          @if (link()?.lastDelivery; as last) {
            <p class="muted">
              Last delivery: {{ last.status }} · {{ last.event }} · {{ last.hall }} ·
              {{ last.at | date: 'd MMM y, HH:mm' }}
              @if (last.error) {
                · {{ last.error }}
              }
            </p>
          }
        </div>
        <div class="card-actions end">
          <button pButton type="submit" [disabled]="busy() || form.pristine">Save</button>
        </div>
      </form>
    </div>
  `,
  styles: `
    .enabled {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `,
})
export class VenueSystemCardComponent {
  private readonly api = inject(AdminApi);
  private readonly notifier = inject(Notifier);

  readonly organisationId = input.required<string>();

  protected readonly link = signal<VenueIntegration | null>(null);
  protected readonly busy = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    callbackUrl: ['', [Validators.required, Validators.maxLength(500)]],
    secret: ['', [Validators.minLength(16), Validators.maxLength(256)]],
    enabled: [true],
  });

  constructor() {
    effect(() => void this.load(this.organisationId()));
  }

  private async load(id: string): Promise<void> {
    try {
      this.show(await firstValueFrom(this.api.integration(id)));
    } catch {
      // The error interceptor has shown it.
    }
  }

  private show(link: VenueIntegration): void {
    this.link.set(link);
    this.form.reset({
      callbackUrl: link.callbackUrl ?? '',
      secret: '',
      enabled: link.configured ? link.enabled : true,
    });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.saveIntegration(this.organisationId(), {
          callbackUrl: v.callbackUrl.trim(),
          ...(v.secret ? { secret: v.secret } : {}),
          enabled: v.enabled,
        }),
      );
      this.show(saved);
      this.notifier.success('Venue system link saved.');
    } catch {
      // The error interceptor has shown it.
    } finally {
      this.busy.set(false);
    }
  }
}
