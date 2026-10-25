import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { firstValueFrom } from 'rxjs';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { CategoriesApiService } from '../../../categories/data/categories-api.service';
import { categoryGroups } from '../../../categories/domain/category-groups';
import { ItpoEventsApiService } from '../../data/itpo-events-api.service';
import {
  EventConfigApiService,
  EventConfigBody,
  EventConfigRecord,
} from '../../data/event-config-api.service';

type Field = { key: string; label: string };

const COUNT = /^[0-9]+$/;
const day = (v: Date | null) => v?.toISOString() ?? undefined;
const toDate = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** Every date and time of the form is a date picker with a time; these are the groups it shows. */
const PUBLIC_DATES: Field[] = [
  { key: 'stallStart', label: 'Public stall booking starts' },
  { key: 'stallEnd', label: 'Public stall booking ends' },
  { key: 'challanLast', label: 'Last date to upload the challan' },
];
const MARQUEE_DATES: Field[] = [
  { key: 'marqueeStart', label: 'Marquee registration starts' },
  { key: 'marqueeEnd', label: 'Marquee registration ends' },
  { key: 'marqueePublicStart', label: 'Marquee stall booking starts' },
  { key: 'marqueePublicEnd', label: 'Marquee stall booking ends' },
];
const FNB_DATES: Field[] = [
  { key: 'fnbRegisterStart', label: 'F&B registration starts' },
  { key: 'fnbRegisterEnd', label: 'F&B registration ends' },
  { key: 'fnbBookingStart', label: 'F&B booking starts' },
  { key: 'fnbBookingEnd', label: 'F&B booking ends' },
];
const EXTRA_DATES: Field[] = [
  { key: 'brandingStart', label: 'Branding booking starts' },
  { key: 'brandingEnd', label: 'Branding booking ends' },
  { key: 'ledStart', label: 'LED booking starts' },
  { key: 'ledEnd', label: 'LED booking ends' },
  { key: 'sponsorStart', label: 'Sponsor booking starts' },
  { key: 'sponsorEnd', label: 'Sponsor booking ends' },
];
const SHOWS: Field[] = [
  { key: 'showLed', label: 'Show LED branding' },
  { key: 'showBranding', label: 'Show branding' },
  { key: 'showSponsor', label: 'Show sponsor' },
  { key: 'showService', label: 'Show service' },
  { key: 'showAllotment', label: 'Show allotment letter' },
  { key: 'showEntry', label: 'Show material entry' },
  { key: 'showExit', label: 'Show material exit' },
];

/** What a form says is wrong across fields, as the booking rules of SelfCare have it. */
function crossChecks(g: AbstractControl): ValidationErrors | null {
  const at = (k: string) => (g.get(k)?.value as Date | null)?.getTime() ?? null;
  const [stallStart, stallEnd] = [at('stallStart'), at('stallEnd')];
  const [marqueeStart, marqueeEnd] = [at('marqueeStart'), at('marqueeEnd')];
  const errors: Record<string, true> = {};
  if (marqueeStart && stallStart && stallStart <= (marqueeEnd ?? marqueeStart)) {
    errors['stallBeforeMarquee'] = true;
  }
  if (marqueeEnd && stallEnd && stallEnd <= marqueeEnd) errors['stallBeforeMarquee'] = true;
  const after = (a: string, b: string, error: string, strict: boolean) => {
    const [x, y] = [at(a), at(b)];
    if (x && y && (strict ? x >= y : y < x)) errors[error] = true;
  };
  after('ledStart', 'ledEnd', 'ledDates', true);
  after('sponsorStart', 'sponsorEnd', 'sponsorDates', true);
  after('brandingStart', 'brandingEnd', 'brandingDates', false);
  after('stallStart', 'stallEnd', 'stallDates', false);
  return Object.keys(errors).length ? errors : null;
}

const MESSAGES: Record<string, string> = {
  stallBeforeMarquee: 'Public stall booking must start and end after the marquee dates.',
  ledDates: 'LED booking must start before it ends.',
  sponsorDates: 'Sponsor booking must start before it ends.',
  brandingDates: 'Branding booking cannot end before it starts.',
  stallDates: 'Public stall booking cannot end before it starts.',
};

/**
 * An internal event's stall booking configuration (SelfCare's "Add/Update Event Configuration"):
 * the category type, how many stalls and categories a user may book, the dates of public, marquee,
 * F&B, branding, LED and sponsor booking, and what the booking site shows. Saved to ITPO's own
 * record, so SelfCare reads the same values.
 */
@Component({
  selector: 'app-event-config-tab',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    InputTextModule,
    SelectModule,
    TextareaModule,
  ],
  templateUrl: './event-config-tab.component.html',
  styleUrl: './event-config-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventConfigTabComponent {
  readonly eventId = input.required<string>();
  readonly readonly = input(false);

  private readonly api = inject(EventConfigApiService);
  private readonly events = inject(ItpoEventsApiService);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(NotifierService);

  protected readonly publicDates = PUBLIC_DATES;
  protected readonly marqueeDates = MARQUEE_DATES;
  protected readonly fnbDates = FNB_DATES;
  protected readonly extraDates = EXTRA_DATES;
  protected readonly shows = SHOWS;
  protected readonly categoryCounts = [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: n }));
  protected readonly securityTypes = [
    { label: 'Fixed', value: 'fixed' },
    { label: 'Percentage', value: 'percentage' },
  ];
  protected readonly types = signal<Array<{ name: string; slug: string }>>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly saving = signal(false);
  protected readonly messages = MESSAGES;

  protected readonly form = new FormGroup(
    {
      eventCategory: new FormControl('', { nonNullable: true, validators: Validators.required }),
      noOfStalls: new FormControl('1', [Validators.pattern(COUNT), numberBetween(1, 200)]),
      maxCategories: new FormControl(1, { nonNullable: true }),
      isSecondaryCatEnabled: new FormControl(false, { nonNullable: true }),
      isMarqueeEnabled: new FormControl(false, { nonNullable: true }),
      stallStart: new FormControl<Date | null>(null),
      stallEnd: new FormControl<Date | null>(null),
      challanLast: new FormControl<Date | null>(null),
      marqueeStart: new FormControl<Date | null>(null),
      marqueeEnd: new FormControl<Date | null>(null),
      marqueePublicStart: new FormControl<Date | null>(null),
      marqueePublicEnd: new FormControl<Date | null>(null),
      marqueeInfo: new FormControl('', { nonNullable: true }),
      isFnb: new FormControl(false, { nonNullable: true }),
      fnbRegisterStart: new FormControl<Date | null>(null),
      fnbRegisterEnd: new FormControl<Date | null>(null),
      fnbBookingStart: new FormControl<Date | null>(null),
      fnbBookingEnd: new FormControl<Date | null>(null),
      fnbInfo: new FormControl('', { nonNullable: true }),
      fnbSecurity: new FormControl(false, { nonNullable: true }),
      fnbType: new FormControl('', { nonNullable: true }),
      fnbValue: new FormControl('', Validators.pattern(COUNT)),
      brandingStart: new FormControl<Date | null>(null),
      brandingEnd: new FormControl<Date | null>(null),
      ledStart: new FormControl<Date | null>(null),
      ledEnd: new FormControl<Date | null>(null),
      sponsorStart: new FormControl<Date | null>(null),
      sponsorEnd: new FormControl<Date | null>(null),
      showLed: new FormControl(false, { nonNullable: true }),
      showBranding: new FormControl(false, { nonNullable: true }),
      showSponsor: new FormControl(false, { nonNullable: true }),
      showService: new FormControl(false, { nonNullable: true }),
      showAllotment: new FormControl(false, { nonNullable: true }),
      showEntry: new FormControl(false, { nonNullable: true }),
      showExit: new FormControl(false, { nonNullable: true }),
      sponsorPdf: new FormControl('', { nonNullable: true }),
      brandingPdf: new FormControl('', { nonNullable: true }),
      cartTimer: new FormControl('', Validators.pattern(COUNT)),
    },
    { validators: crossChecks },
  );

  /** The saved record; null while the event has no configuration. */
  private record: EventConfigRecord | null = null;
  protected readonly exists = signal(false);

  constructor() {
    this.form.controls.isMarqueeEnabled.valueChanges.subscribe((on) => {
      this.require(this.form.controls.marqueeStart, on);
      this.require(this.form.controls.marqueeEnd, on);
      this.require(this.form.controls.marqueeInfo, on);
    });
    this.form.controls.showSponsor.valueChanges.subscribe((on) =>
      this.require(this.form.controls.sponsorPdf, on),
    );
    this.form.controls.showBranding.valueChanges.subscribe((on) =>
      this.require(this.form.controls.brandingPdf, on),
    );
    void this.load();
  }

  protected control(key: string): FormControl {
    return this.form.get(key) as FormControl;
  }

  protected errors(): string[] {
    return Object.keys(this.form.errors ?? {}).map((k) => MESSAGES[k]);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifier.warn('Fill the highlighted fields correctly.');
      return;
    }
    const go = await this.confirm.ask({
      header: 'Save the configuration',
      message: 'Save the stall booking configuration of this event?',
      acceptLabel: 'Save',
    });
    if (!go) return;
    this.saving.set(true);
    try {
      const body = this.body();
      await firstValueFrom(
        this.exists() && this.record
          ? this.api.update(this.record.id, body)
          : this.api.create(body),
      );
      this.notifier.success('Configuration saved');
      await this.loadRecord();
    } catch (error) {
      this.notifier.fromError(error, 'The configuration could not be saved');
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const groups = await firstValueFrom(this.categoriesApi.groups());
      this.types.set(categoryGroups(groups).map((g) => ({ name: g.name, slug: g.slug })));
      await this.loadRecord();
    } catch (error) {
      this.failed.set(true);
      this.notifier.fromError(error, 'The configuration could not be loaded');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadRecord(): Promise<void> {
    const r = await firstValueFrom(this.api.get(this.eventId()));
    this.record = r;
    // A record is there when ITPO has an id for it, whatever its category: its dates are shown and
    // saving updates it (SelfCare only filled the form when the event had a category).
    this.exists.set(!!r?.id);
    if (r?.id) this.fill(r);
    await this.fillFromEvent();
    if (this.readonly()) this.form.disable({ emitEvent: false });
  }

  /**
   * The event's own booking basics (its category type, stall limit, marquee) fill what the
   * configuration does not have yet: an event with no configuration starts from them.
   */
  private async fillFromEvent(): Promise<void> {
    try {
      const event = await firstValueFrom(this.events.event(this.eventId()));
      const c = this.form.controls;
      const category = event.productCategory;
      if (category && !c.eventCategory.value) {
        if (!this.types().some((type) => type.slug === category)) {
          this.types.update((list) => [...list, { name: category, slug: category }]);
        }
        c.eventCategory.setValue(category);
      }
      if (!this.exists()) {
        if (event.noOfStalls) c.noOfStalls.setValue(String(event.noOfStalls));
        if (event.maxCategoriesForRegistration) {
          c.maxCategories.setValue(event.maxCategoriesForRegistration);
        }
        c.isMarqueeEnabled.setValue(!!event.isMarqueeEnabled);
        c.isSecondaryCatEnabled.setValue(!!event.isSecondaryEnabled);
      }
    } catch {
      // The event's details are a convenience: the form is usable without them.
    }
  }

  private fill(r: EventConfigRecord): void {
    // A category type the list does not hold (switched off, or not one of the booking types) is
    // still shown, as it was saved.
    const category = r.eventCategory;
    if (category && !this.types().some((type) => type.slug === category)) {
      this.types.update((list) => [...list, { name: category, slug: category }]);
    }
    this.form.reset(
      {
        eventCategory: r.eventCategory ?? '',
        noOfStalls: String(r.noOfStalls || 1),
        maxCategories: r.maxCategoriesForRegistration || 1,
        isSecondaryCatEnabled: !!r.isSecondaryCatEnabled,
        isMarqueeEnabled: !!r.isMarqueeEnabled,
        stallStart: toDate(r.stall_booking_start_date),
        stallEnd: toDate(r.stall_booking_end_date),
        challanLast: toDate(r.challan_last_date),
        marqueeStart: toDate(r.marquee_registration_date),
        marqueeEnd: toDate(r.marquee_booking_end_date),
        marqueePublicStart: toDate(r.marquees_booking_start_date),
        marqueePublicEnd: toDate(r.marquees_booking_end_date),
        marqueeInfo: r.marquee_registeration_info ?? '',
        isFnb: !!r.show_fnb_option,
        fnbRegisterStart: toDate(r.fnb_register_start_date),
        fnbRegisterEnd: toDate(r.fnb_register_end_date),
        fnbBookingStart: toDate(r.fnb_booking_start_date),
        fnbBookingEnd: toDate(r.fnb_booking_end_date),
        fnbInfo: r.fnb_registeration_info ?? '',
        fnbSecurity: !!r.fnb_enable_sequerty,
        fnbType: r.fnb_type ?? '',
        fnbValue: String(r.fnb_sequerty_value ?? ''),
        brandingStart: toDate(r.branding_booking_start_date),
        brandingEnd: toDate(r.branding_booking_end_date),
        ledStart: toDate(r.led_booking_start_date),
        ledEnd: toDate(r.led_booking_end_date),
        sponsorStart: toDate(r.sponsor_booking_start_date),
        sponsorEnd: toDate(r.sponsor_booking_end_date),
        showLed: !!r.show_led_option,
        showBranding: !!r.show_branding_option,
        showSponsor: !!r.show_sponsor_option,
        showService: !!r.show_service_event,
        showAllotment: !!r.show_allotment_letter,
        showEntry: !!r.show_material_entry,
        showExit: !!r.show_material_exit,
        sponsorPdf: r.sponsor_pdf_link ?? '',
        brandingPdf: r.branding_pdf_link ?? '',
        cartTimer: r.cart_timer_minutes === null ? '' : String(r.cart_timer_minutes),
      },
      { emitEvent: true },
    );
  }

  /** The body ITPO takes, as SelfCare builds it: what does not apply is left out. */
  private body(): EventConfigBody {
    const v = this.form.getRawValue();
    const marquee = v.isMarqueeEnabled;
    const body: EventConfigBody = {
      eventId: this.eventId(),
      stall_booking_start_date: v.stallStart ? day(v.stallStart) : undefined,
      stall_booking_end_date: v.stallStart ? day(v.stallEnd) : undefined,
      challanLastDate: day(v.challanLast),
      isMarqueeEnabled: marquee,
      isSecondaryCatEnabled: v.isSecondaryCatEnabled,
      noOfStalls: Number(v.noOfStalls),
      maxCategoriesForRegistration: v.maxCategories,
      eventCategory: v.eventCategory,
      fnb_register_start_date: day(v.fnbRegisterStart),
      fnb_register_end_date: day(v.fnbRegisterEnd),
      fnb_booking_start_date: day(v.fnbBookingStart),
      fnb_booking_end_date: day(v.fnbBookingEnd),
      show_fnb_option: v.isFnb,
      fnbRegisterationInfo: v.fnbInfo || undefined,
      branding_booking_start_date: day(v.brandingStart),
      branding_booking_end_date: day(v.brandingEnd),
      led_booking_start_date: day(v.ledStart),
      led_booking_end_date: day(v.ledEnd),
      sponsor_booking_start_date: day(v.sponsorStart),
      sponsor_booking_end_date: day(v.sponsorEnd),
      show_led_option: v.showLed,
      show_sponsor_option: v.showSponsor,
      sponsor_pdf_link: v.sponsorPdf || undefined,
      show_branding_option: v.showBranding,
      branding_pdf_link: v.brandingPdf || undefined,
      show_allotment_letter: v.showAllotment,
      show_material_entry: v.showEntry,
      show_material_exit: v.showExit,
      show_service_event: v.showService,
      fnb_enable_sequerty: v.fnbSecurity,
      fnb_type: v.fnbType,
      fnb_sequerty_value: Number(v.fnbValue || 0),
      // Blank clears the override: the event uses the platform default.
      cart_timer_minutes: v.cartTimer ? Number(v.cartTimer) : null,
    };
    if (marquee) {
      body['marquee_registration_date'] = day(v.marqueeStart);
      body['marquee_booking_end_date'] = day(v.marqueeEnd);
      body['marquee_public_registration_date'] = day(v.marqueePublicStart);
      body['marquee_public_booking_end_date'] = day(v.marqueePublicEnd);
      body['marqueeRegisterationInfo'] = v.marqueeInfo || undefined;
    }
    return body;
  }

  private require(control: AbstractControl, on: boolean): void {
    if (on) control.addValidators(Validators.required);
    else control.removeValidators(Validators.required);
    control.updateValueAndValidity({ emitEvent: false });
  }
}

function numberBetween(min: number, max: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const n = Number(control.value);
    return !control.value || (n >= min && n <= max) ? null : { range: { min, max } };
  };
}
