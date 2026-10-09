import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  effect,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { startWith } from 'rxjs';

import {
  FONT_FAMILIES,
  FontFamily,
  Language,
  LANGUAGES,
  OrganisationConfig,
} from '../../core/api/api.models';
import { ThemeService } from '../../core/theme/theme.service';
import { BrandMarkComponent } from '../brand-mark.component';
import { FieldComponent } from '../field.component';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { AutoCompleteModule } from 'primeng/autocomplete';

const HEX = /^#[0-9a-fA-F]{6}$/;
const IMAGE_URL = /^(https:\/\/[^\s"'<>]+|\/[\w\-./]+)$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const INVOICE_PREFIX = /^[A-Z0-9/-]{1,12}$/;
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'SAR', 'JPY'];
const TIMEZONES: readonly string[] = Intl.supportedValuesOf('timeZone');

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null);

/** The form's shape of a configuration: empty strings where the API has null. */
function toFormValue(config: OrganisationConfig) {
  return {
    branding: {
      primaryColor: config.branding.primaryColor,
      accentColor: config.branding.accentColor ?? '',
      fontFamily: config.branding.fontFamily,
      logoUrl: config.branding.logoUrl ?? '',
      logoDarkUrl: config.branding.logoDarkUrl ?? '',
      faviconUrl: config.branding.faviconUrl ?? '',
    },
    locale: { ...config.locale, languages: [...config.locale.languages] },
    legal: {
      legalName: config.legal.legalName ?? '',
      gstin: config.legal.gstin ?? '',
      address: config.legal.address ?? '',
      invoicePrefix: config.legal.invoicePrefix ?? '',
      supportEmail: config.legal.supportEmail ?? '',
    },
    email: {
      senderName: config.email.senderName ?? '',
      replyTo: config.email.replyTo ?? '',
      footer: config.email.footer ?? '',
    },
  };
}

/**
 * Edits an organisation's configuration: branding, language and region, invoice details and
 * email. The preview beside it is themed with the colours being edited, so a choice can be
 * judged before it is saved.
 */
@Component({
  selector: 'app-config-form',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    BrandMarkComponent,
    FieldComponent,
    InputTextModule,
    TextareaModule,
    SelectModule,
    MultiSelectModule,
    AutoCompleteModule,
  ],
  templateUrl: './config-form.component.html',
  styleUrl: './config-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigFormComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly theme = inject(ThemeService);

  readonly config = input.required<OrganisationConfig>();
  readonly organisationName = input.required<string>();
  readonly readonly = input(false);
  readonly saving = input(false);
  readonly save = output<OrganisationConfig>();

  protected readonly fonts = [...FONT_FAMILIES];
  protected readonly languages = [...LANGUAGES];
  protected readonly currencies = [...CURRENCIES];

  protected readonly form = this.fb.group({
    branding: this.fb.group({
      primaryColor: ['', [Validators.required, Validators.pattern(HEX)]],
      accentColor: ['', Validators.pattern(HEX)],
      fontFamily: this.fb.control<FontFamily>('Inter'),
      logoUrl: ['', [Validators.pattern(IMAGE_URL), Validators.maxLength(2048)]],
      logoDarkUrl: ['', [Validators.pattern(IMAGE_URL), Validators.maxLength(2048)]],
      faviconUrl: ['', [Validators.pattern(IMAGE_URL), Validators.maxLength(2048)]],
    }),
    locale: this.fb.group({
      defaultLanguage: this.fb.control<Language>('en'),
      languages: this.fb.control<Language[]>(['en'], Validators.required),
      currency: ['INR', Validators.required],
      timezone: ['Asia/Kolkata', Validators.required],
    }),
    legal: this.fb.group({
      legalName: ['', Validators.maxLength(200)],
      gstin: ['', Validators.pattern(GSTIN)],
      address: ['', Validators.maxLength(500)],
      invoicePrefix: ['', Validators.pattern(INVOICE_PREFIX)],
      supportEmail: ['', [Validators.email, Validators.maxLength(254)]],
    }),
    email: this.fb.group({
      senderName: ['', Validators.maxLength(120)],
      replyTo: ['', [Validators.email, Validators.maxLength(254)]],
      footer: ['', Validators.maxLength(1000)],
    }),
  });

  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(this.form.value)), {
    requireSync: true,
  });
  private readonly preview = viewChild.required<ElementRef<HTMLElement>>('preview');

  /** Any IANA name is accepted (browsers list some under old names, e.g. Asia/Calcutta). */
  protected readonly timezoneQuery = signal('');
  protected readonly timezoneSuggestions = computed(() => {
    const query = this.timezoneQuery().toLowerCase();
    return TIMEZONES.filter((zone) => zone.toLowerCase().includes(query)).slice(0, 50);
  });
  protected readonly brandPreview = computed(() => {
    const branding = this.value().branding ?? {};
    return {
      primaryColor: HEX.test(branding.primaryColor ?? '') ? branding.primaryColor! : '#1f5fbf',
      accentColor: HEX.test(branding.accentColor ?? '') ? branding.accentColor! : null,
      fontFamily: branding.fontFamily ?? 'Inter',
      logoUrl: IMAGE_URL.test(branding.logoUrl ?? '') ? branding.logoUrl! : null,
      logoDarkUrl: IMAGE_URL.test(branding.logoDarkUrl ?? '') ? branding.logoDarkUrl! : null,
    };
  });

  constructor() {
    effect(() => this.form.reset(toFormValue(this.config())));

    effect(() => {
      if (this.readonly()) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
    });

    effect(() => {
      const branding = this.brandPreview();
      this.theme.applyTo(this.preview().nativeElement, branding);
      this.theme.loadFont(branding.fontFamily);
    });
  }

  /**
   * The colour picker writes into the same control as the hex field beside it. Two inputs
   * bound to one control do not update each other, so the picker reads the value instead.
   */
  protected pickColor(name: 'primaryColor' | 'accentColor', event: Event): void {
    const control = this.form.controls.branding.controls[name];
    control.setValue((event.target as HTMLInputElement).value);
    control.markAsDirty();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { branding, locale, legal, email } = this.form.getRawValue();
    if (!locale.languages.includes(locale.defaultLanguage)) {
      this.form.controls.locale.controls.languages.setErrors({ missingDefault: true });
      this.form.controls.locale.controls.languages.markAsTouched();
      return;
    }
    this.save.emit({
      branding: {
        primaryColor: branding.primaryColor.toLowerCase(),
        accentColor: blankToNull(branding.accentColor)?.toLowerCase() ?? null,
        fontFamily: branding.fontFamily,
        logoUrl: blankToNull(branding.logoUrl),
        logoDarkUrl: blankToNull(branding.logoDarkUrl),
        faviconUrl: blankToNull(branding.faviconUrl),
      },
      locale,
      legal: {
        legalName: blankToNull(legal.legalName),
        gstin: blankToNull(legal.gstin.toUpperCase()),
        address: blankToNull(legal.address),
        invoicePrefix: blankToNull(legal.invoicePrefix.toUpperCase()),
        supportEmail: blankToNull(legal.supportEmail),
      },
      email: {
        senderName: blankToNull(email.senderName),
        replyTo: blankToNull(email.replyTo),
        footer: blankToNull(email.footer),
      },
    });
  }

  protected discard(): void {
    this.form.reset(toFormValue(this.config()));
  }
}
