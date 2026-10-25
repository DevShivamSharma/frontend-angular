import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { firstValueFrom } from 'rxjs';

import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { ApiError } from '../../../../core/http/api-error';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { PlansApiService } from '../../data/plans-api.service';
import {
  dateOfDay,
  dayOf,
  dayOfDate,
  endOfDay,
  RATE_TYPES,
  RateCardView,
  RatePeriod,
  RateType,
  startOfDay,
} from '../../domain/rate-card.models';

export interface RateCardData {
  eventId: string;
  hallId: string;
  hallName: string;
  view: RateCardView;
}

const TYPE_HELP: Record<RateType, string> = {
  General: 'Prices every stall that is not Premium or Marquee. Needed.',
  Premium: 'Prices the stalls marked Premium. Leave empty to price them as General.',
  Marquee: 'Prices the stalls marked Marquee available. Leave empty to price them as General.',
};

type PeriodGroup = ReturnType<typeof periodGroup>;

/**
 * The hall's rate card, as ITPO keeps it and SelfCare prices bookings from: per price type, the
 * rates per m² for bare space and shell scheme, the extra for 2, 3 and 4 open sides, the catalogue
 * charge and a food and beverage price, for each period of days (early-bird and late rates).
 * Closes with the saved card.
 */
@Component({
  selector: 'app-rate-card-dialog',
  imports: [ReactiveFormsModule, ButtonModule, DatePickerModule, InputNumberModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rate-card-dialog.component.html',
  styleUrl: './rate-card-dialog.component.scss',
})
export class RateCardDialogComponent {
  protected readonly data = dialogData<RateCardData>();
  protected readonly ref = inject(DialogRef);
  private readonly api = inject(PlansApiService);

  protected readonly types = RATE_TYPES;
  protected readonly help = TYPE_HELP;
  protected readonly tab = signal<RateType>('General');
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly editable = this.data.view.canManage;
  protected readonly forms: Record<RateType, FormArray<PeriodGroup>> = {
    General: this.arrayOf('General'),
    Premium: this.arrayOf('Premium'),
    Marquee: this.arrayOf('Marquee'),
  };
  protected readonly version = signal(0);

  protected periods(type: RateType): FormArray<PeriodGroup> {
    return this.forms[type];
  }

  protected add(type: RateType): void {
    const list = this.forms[type];
    const last = list.at(list.length - 1)?.getRawValue();
    list.push(periodGroup(type, last ? nextPeriod(last) : undefined));
    this.version.update((n) => n + 1);
  }

  protected remove(type: RateType, index: number): void {
    this.forms[type].removeAt(index);
    this.version.update((n) => n + 1);
  }

  protected async save(): Promise<void> {
    const all = RATE_TYPES.flatMap((type) => this.forms[type].controls);
    if (all.some((g) => g.invalid)) {
      all.forEach((g) => g.markAllAsTouched());
      this.error.set('Fill the highlighted rates and dates.');
      return;
    }
    this.error.set('');
    this.saving.set(true);
    try {
      const periods = all.map((g) => toPeriod(g));
      const saved = await firstValueFrom(
        this.api.saveRateCard(this.data.eventId, this.data.hallId, periods),
      );
      this.ref.close(saved);
    } catch (error) {
      this.error.set(error instanceof ApiError ? error.message : 'The rates could not be saved.');
    } finally {
      this.saving.set(false);
    }
  }

  private arrayOf(type: RateType): FormArray<PeriodGroup> {
    const own = this.data.view.periods.filter((p) => p.type === type);
    return new FormArray(
      (own.length || type !== 'General' ? own : [undefined]).map((p) => periodGroup(type, p)),
    );
  }
}

function periodGroup(
  type: RateType,
  p?: Partial<RatePeriod> & { startDay?: string; endDay?: string },
) {
  const money = [Validators.required, Validators.min(0)];
  const today = dayOfDate(new Date());
  return new FormGroup({
    id: new FormControl<string | null>(p?.id ?? null),
    type: new FormControl<RateType>(type, { nonNullable: true }),
    /** Kept to tell whether a day was changed: an untouched end keeps its time. */
    startAt: new FormControl(p?.startAt ?? null),
    endAt: new FormControl(p?.endAt ?? null),
    start: new FormControl<Date | null>(
      dateOfDay(p?.startDay ?? (p?.startAt ? dayOf(p.startAt) : today)),
      Validators.required,
    ),
    end: new FormControl<Date | null>(
      dateOfDay(p?.endDay ?? (p?.endAt ? dayOf(p.endAt) : today)),
      Validators.required,
    ),
    bareRate: new FormControl<number | null>(p?.bareRate ?? null, money),
    shellRate: new FormControl<number | null>(p?.shellRate ?? null, money),
    side2Percent: new FormControl<number | null>(p?.side2Percent ?? 0, money),
    side3Percent: new FormControl<number | null>(p?.side3Percent ?? 0, money),
    side4Percent: new FormControl<number | null>(p?.side4Percent ?? 0, money),
    catalogueCharge: new FormControl<number | null>(p?.catalogueCharge ?? 0, money),
    fnbPrice: new FormControl<number | null>(p?.fnbPrice ?? null, Validators.min(0)),
  });
}

/** The next period starts the day after the last one ends, on the same rates. */
function nextPeriod(last: ReturnType<PeriodGroup['getRawValue']>): Partial<RatePeriod> & {
  startDay: string;
  endDay: string;
} {
  const end = last.end ?? new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 12);
  const finish = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 30, 12);
  return {
    startDay: dayOfDate(start),
    endDay: dayOfDate(finish),
    bareRate: last.bareRate ?? undefined,
    shellRate: last.shellRate ?? undefined,
    side2Percent: last.side2Percent ?? 0,
    side3Percent: last.side3Percent ?? 0,
    side4Percent: last.side4Percent ?? 0,
    catalogueCharge: last.catalogueCharge ?? 0,
    fnbPrice: last.fnbPrice,
  };
}

/** A period as the server takes it. A day left as it was keeps SelfCare's own time of day. */
function toPeriod(g: PeriodGroup): RatePeriod {
  const v = g.getRawValue();
  const startDay = dayOfDate(v.start!);
  const endDay = dayOfDate(v.end!);
  return {
    ...(v.id ? { id: v.id } : {}),
    type: v.type,
    startAt: v.startAt && dayOf(v.startAt) === startDay ? v.startAt : startOfDay(startDay),
    endAt: v.endAt && dayOf(v.endAt) === endDay ? v.endAt : endOfDay(endDay),
    bareRate: v.bareRate!,
    shellRate: v.shellRate!,
    side2Percent: v.side2Percent!,
    side3Percent: v.side3Percent!,
    side4Percent: v.side4Percent!,
    catalogueCharge: v.catalogueCharge!,
    fnbPrice: v.fnbPrice,
  };
}
