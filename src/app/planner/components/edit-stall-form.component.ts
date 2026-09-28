import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { isCustomStall, stallArea, stallSizeText } from '../geometry/footprint-view';
import { sidesOfEdges } from '../geometry/stall-footprint';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { num } from '../geometry/planner-geometry';
import { GATE_COMPASS, GATE_SIDES } from './gate-sides';
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
  readonly gateCompass = GATE_COMPASS;
  readonly selectedStall = this.store.selectedStall;
  readonly splitPreview = this.store.splitPreview;
  readonly canConfirmSplit = this.store.canConfirmSplit;
  readonly busy = this.store.busy;
  readonly passageWidth = this.store.passageWidth;
  readonly splitForm = this.fb.nonNullable.group({
    count: 2,
    axis: 'X' as 'X' | 'Z',
    arrangement: 'PASSAGE' as 'PASSAGE' | 'BACK_TO_BACK'
  });

  readonly form = this.fb.nonNullable.group({
    name: '',
    width: 5,
    length: 5,
    height: 4,
    rotation: 0,
    posX: 0,
    posZ: 0
  }, { updateOn: 'blur' });

  constructor() {
    this.splitForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.store.dismissSplit());
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
    controls.rotation.valueChanges.pipe(takeUntilDestroyed())
      .subscribe(value => this.patchSelected({ rotation: num(value, 0) }));

    controls.posX.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => {
      const stall = this.selectedStall();
      if (!stall) return;
      this.store.placeStall(stall.id, num(value), stall.posZ);
      this.syncFromStore();
    });

    controls.posZ.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => {
      const stall = this.selectedStall();
      if (!stall) return;
      this.store.placeStall(stall.id, stall.posX, num(value));
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

  setFacing(input: HTMLSelectElement): void {
    const stall = this.selectedStall();
    if (stall) this.store.updateStall(stall.id, { openSides: [input.value as GateSide] });
    input.value = this.selectedStall()?.openSides.length === 1 ? this.selectedStall()!.openSides[0] : '';
  }

  readonly isCustom = isCustomStall;
  readonly area = stallArea;
  readonly sizeText = stallSizeText;

  /** Every edge of a custom outline: its length, which way it faces, and whether it is open. */
  edgesOf(stall: Stall): Array<{ index: number; length: number; facing: string; open: boolean }> {
    const poly = stall.footprint ?? [];
    return poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return {
        index: i,
        length: Math.round(Math.hypot(b.x - a.x, b.z - a.z) * 100) / 100,
        facing: sidesOfEdges(poly, [i])[0]?.toLowerCase() ?? '',
        open: (stall.openEdges ?? []).includes(i)
      };
    });
  }

  toggleEdge(index: number): void {
    const stall = this.selectedStall();
    if (stall) this.store.toggleOpenEdge(stall.id, index);
  }

  previewSplit(): void {
    this.store.previewStallSplit(this.splitForm.getRawValue());
  }

  confirmSplit(): void { void this.store.confirmSplit(); }
  cancelSplit(): void { this.store.dismissSplit(); }

  /** Close the editor by clearing the selection. */
  close(): void {
    this.store.selectStall(null);
  }

  applyChanges(): void {
    this.store.saveEdit();
  }

  /** A numbered (saved) stall is cancelled, keeping its number; an unsaved one is removed. */
  removeStall(): void {
    const stall = this.selectedStall();
    if (stall) this.store.cancelStall(stall.id);
  }

  private patchSelected(patch: Partial<Stall>): void {
    const stall = this.selectedStall();
    if (stall) this.store.updateStall(stall.id, patch);
    this.syncFromStore();
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
      rotation: stall.rotation ?? 0,
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
