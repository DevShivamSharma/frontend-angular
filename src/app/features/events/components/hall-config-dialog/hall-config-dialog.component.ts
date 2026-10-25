import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormArray,
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
import { TextareaModule } from 'primeng/textarea';
import { firstValueFrom } from 'rxjs';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { dialogData, DialogRef } from '../../../../core/dialog/app-dialog.service';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { HallConfig, HallConfigApiService } from '../../data/hall-config-api.service';

export interface HallConfigData {
  eventId: string;
  eventHallId: string;
  hallName: string;
  /** The hall sells food and beverage stalls: its own limit is asked. */
  isFnb: boolean;
}

/** A window needs at least one end; and it cannot end before it begins. */
function window(group: AbstractControl): ValidationErrors | null {
  const start = group.get('startDate')?.value as Date | null;
  const end = group.get('endDate')?.value as Date | null;
  if (!start && !end) return { empty: true };
  if (start && end && start.getTime() > end.getTime()) return { range: true };
  return null;
}

const COUNT = /^[0-9]+$/;

function configGroup(c?: HallConfig) {
  return new FormGroup(
    {
      startDate: new FormControl<Date | null>(c?.startDate ? new Date(c.startDate) : null),
      endDate: new FormControl<Date | null>(c?.endDate ? new Date(c.endDate) : null),
      stallCount: new FormControl(c?.stallCount?.toString() ?? '', Validators.pattern(COUNT)),
      fnbStallCount: new FormControl(c?.fnbStallCount?.toString() ?? '', Validators.pattern(COUNT)),
      description: new FormControl(c?.description ?? '', Validators.maxLength(1000)),
      isRestrictedToApp: new FormControl(c?.isRestrictedToApp ?? false, { nonNullable: true }),
    },
    { validators: window },
  );
}

/**
 * SelfCare's "Add/Edit Config" of an event hall: the windows in which stalls can be booked, how
 * many stalls one user may book, a description, and whether the hall is for the mobile app only.
 * Each window is one row; the rows replace the hall's configuration when saved.
 */
@Component({
  selector: 'app-hall-config-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    InputTextModule,
    TextareaModule,
    IconComponent,
  ],
  templateUrl: './hall-config-dialog.component.html',
  styleUrl: './hall-config-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HallConfigDialogComponent {
  protected readonly data = dialogData<HallConfigData>();
  protected readonly ref = inject(DialogRef);
  private readonly api = inject(HallConfigApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(NotifierService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly exists = signal(false);
  protected readonly rows = new FormArray([configGroup()]);
  /** Adding or removing a row changes a form array, which signals do not see. */
  protected readonly version = signal(0);

  constructor() {
    void this.load();
  }

  protected add(): void {
    this.rows.push(configGroup());
    this.version.update((n) => n + 1);
  }

  protected async remove(index: number): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Remove this window',
      message: 'Remove this configuration?',
      acceptLabel: 'Remove',
      danger: true,
    });
    if (!go) return;
    this.rows.removeAt(index);
    this.version.update((n) => n + 1);
  }

  protected async save(): Promise<void> {
    if (this.rows.invalid) {
      this.rows.markAllAsTouched();
      return;
    }
    const go = await this.confirm.ask({
      header: 'Save the configuration',
      message: `Save the stall booking configuration of ${this.data.hallName}?`,
      acceptLabel: 'Save',
    });
    if (!go) return;
    this.saving.set(true);
    try {
      const configs = this.rows.getRawValue().map<HallConfig>((v) => ({
        startDate: v.startDate?.toISOString() ?? null,
        endDate: v.endDate?.toISOString() ?? null,
        stallCount: v.stallCount ? Number(v.stallCount) : null,
        fnbStallCount: v.fnbStallCount ? Number(v.fnbStallCount) : null,
        description: v.description?.trim() || null,
        isRestrictedToApp: v.isRestrictedToApp,
      }));
      const { eventId, eventHallId } = this.data;
      await firstValueFrom(
        this.exists()
          ? this.api.update(eventId, eventHallId, configs)
          : this.api.create(eventId, eventHallId, configs),
      );
      this.notifier.success('Configuration saved', this.data.hallName);
      await this.load();
    } catch (error) {
      this.notifier.fromError(error, 'The configuration could not be saved');
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeAll(): Promise<void> {
    const go = await this.confirm.ask({
      header: 'Delete the configuration',
      message: `Delete the whole stall booking configuration of ${this.data.hallName}?`,
      acceptLabel: 'Delete',
      danger: true,
    });
    if (!go) return;
    try {
      await firstValueFrom(this.api.remove(this.data.eventHallId));
      this.notifier.success('Configuration deleted', this.data.hallName);
      await this.load();
    } catch (error) {
      this.notifier.fromError(error, 'The configuration could not be deleted');
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      const configs = await firstValueFrom(this.api.configs(this.data.eventHallId));
      this.exists.set(configs.length > 0);
      this.rows.clear();
      (configs.length ? configs : [undefined]).forEach((c) => this.rows.push(configGroup(c)));
      this.rows.markAsPristine();
      this.version.update((n) => n + 1);
    } catch (error) {
      this.loadFailed.set(true);
      this.notifier.fromError(error, 'The configuration could not be loaded');
    } finally {
      this.loading.set(false);
    }
  }
}
