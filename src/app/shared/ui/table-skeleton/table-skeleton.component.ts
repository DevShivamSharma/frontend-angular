import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';

/** A table's rows while they load: the same rhythm as the real ones, so nothing jumps when they arrive. */
@Component({
  selector: 'app-table-skeleton',
  imports: [SkeletonModule],
  template: `
    <div class="data-table-wrap" aria-hidden="true">
      <table class="data-table">
        <tbody>
          @for (row of rows(); track row) {
            <tr>
              @for (column of columns(); track column) {
                <td [class.hide-sm]="column.hideSmall">
                  <p-skeleton [width]="column.width" height="1rem" />
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableSkeletonComponent {
  readonly count = input(8);
  /** One entry per column: how wide its placeholder is, and whether a phone drops the column. */
  readonly columns = input<{ width: string; hideSmall?: boolean }[]>([
    { width: '60%' },
    { width: '40%', hideSmall: true },
    { width: '5rem' },
  ]);
  protected readonly rows = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
