import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { num } from '../geometry/planner-geometry';
import { GATE_SIDES } from './gate-sides';
import { IconComponent } from './icon.component';
import { GateSide, Stall } from '../models/stall.model';
import { PlannerStore } from '../planner-store.service';

/**
 * "Edit Selected Shop" section. App.js:511-516, App.js:528, App.js:591.
 *
 * Every field writes straight through to the store on change, exactly like the
 * React controlled inputs. X/Z go through `moveStall`, so an out-of-bounds or
 * overlapping value is rejected and the field snaps back to the stored value.
 */
@Component({
  selector: 'app-edit-stall-form',
  templateUrl: './edit-stall-form.component.html',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditStallFormComponent {
  private readonly store = inject(PlannerStore);
  private readonly fb = inject(FormBuilder);

  readonly gateSides = GATE_SIDES;
  readonly selectedStall = this.store.selectedStall;

  readonly form = this.fb.nonNullable.group({
    name: '',
    width: 5,
    length: 5,
    height: 4,
    posX: 0,
    posZ: 0
  });

  constructor() {
    const controls = this.form.controls;

    controls.name.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.patchSelected({ name: value }));

    controls.width.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.patchSelected({ width: num(value, 5) }));

    controls.length.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.patchSelected({ length: num(value, 5) }));

    controls.height.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.patchSelected({ height: num(value, 4) }));

    controls.posX.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => {
      const stall = this.selectedStall();
      if (!stall) return;
      this.store.moveStall(stall.id, num(value), stall.posZ);
      this.syncFromStore();
    });

    controls.posZ.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => {
      const stall = this.selectedStall();
      if (!stall) return;
      this.store.moveStall(stall.id, stall.posX, num(value));
      this.syncFromStore();
    });

    effect(() => {
      this.selectedStall();
      this.syncFromStore();
    });
  }

  toggleGateSide(value: GateSide): void {
    const stall = this.selectedStall();
    if (stall) this.store.toggleOpenSide(stall.id, value);
  }

  applyChanges(): void {
    this.store.saveEdit();
  }

  removeStall(): void {
    const stall = this.selectedStall();
    if (stall) this.store.deleteStall(stall.id);
  }

  private patchSelected(patch: Partial<Stall>): void {
    const stall = this.selectedStall();
    if (stall) this.store.updateStall(stall.id, patch);
  }

  /**
   * Copy the stored stall back into the form.
   *
   * Only differing controls are written so that typing in a text field does
   * not reset the caret to the end on every keystroke.
   */
  private syncFromStore(): void {
    const stall = this.selectedStall();
    if (!stall) return;

    const next = {
      name: stall.name ?? '',
      width: stall.width,
      length: stall.length,
      height: stall.height,
      posX: stall.posX,
      posZ: stall.posZ
    };

    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      const control = this.form.controls[key];
      if (control.value !== next[key]) {
        control.setValue(next[key] as never, { emitEvent: false });
      }
    }
  }
}
