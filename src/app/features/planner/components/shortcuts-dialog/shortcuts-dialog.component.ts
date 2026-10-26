import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { DialogRef } from '../../../../core/dialog/app-dialog.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';

interface Shortcut {
  keys: string[];
  does: string;
}

const GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: 'Tools',
    items: [
      { keys: ['V'], does: 'Select' },
      { keys: ['H'], does: 'Pan' },
      { keys: ['B'], does: 'Draw a booth' },
      { keys: ['Z'], does: 'Draw a zone (rectangle)' },
      { keys: ['P'], does: 'Draw a zone (polygon)' },
      { keys: ['L'], does: 'Line' },
      { keys: ['R'], does: 'Rectangle' },
      { keys: ['C'], does: 'Circle' },
      { keys: ['T'], does: 'Text' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: ['Ctrl', 'Z'], does: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], does: 'Redo (also Ctrl Y)' },
      { keys: ['Ctrl', 'D'], does: 'Copy the selection' },
      { keys: ['Delete'], does: 'Delete the selection' },
      { keys: ['Ctrl', 'S'], does: 'Save' },
    ],
  },
  {
    title: 'While drawing and viewing',
    items: [
      { keys: ['Enter'], does: 'Finish a polygon' },
      { keys: ['Backspace'], does: 'Take back the last corner' },
      { keys: ['Esc'], does: 'Cancel, then go back to Select, then deselect' },
      { keys: ['2'], does: 'Plan in 2D' },
      { keys: ['3'], does: 'Plan in 3D' },
      { keys: ['?'], does: 'This list' },
    ],
  },
];

/** The planner's keyboard shortcuts, for a newcomer and for the one who forgot. */
@Component({
  selector: 'app-shortcuts-dialog',
  imports: [ButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="dialog-title head"><app-icon name="help" /> Keyboard shortcuts</h2>
    <div class="dialog-content groups">
      @for (group of groups; track group.title) {
        <section>
          <h3>{{ group.title }}</h3>
          <dl>
            @for (item of group.items; track item.does) {
              <div class="row">
                <dt>
                  @for (key of item.keys; track key; let last = $last) {
                    <kbd>{{ key }}</kbd>
                    @if (!last) {
                      <span aria-hidden="true">+</span>
                    }
                  }
                </dt>
                <dd>{{ item.does }}</dd>
              </div>
            }
          </dl>
        </section>
      }
    </div>
    <div class="dialog-actions">
      <button pButton type="button" (click)="ref.close()">Close</button>
    </div>
  `,
  styles: `
    .head {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 16px 24px;
      min-width: min(640px, 88vw);
    }
    h3 {
      margin: 0 0 8px;
      font: var(--app-label-large);
    }
    dl {
      display: grid;
      gap: 6px;
      margin: 0;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    dt {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    dd {
      margin: 0;
      color: var(--app-on-surface-variant);
      font: var(--app-body-small);
      text-align: right;
    }
    kbd {
      min-width: 1.5rem;
      padding: 2px 6px;
      border: 1px solid var(--app-outline);
      border-bottom-width: 2px;
      border-radius: 6px;
      background: var(--app-surface-container-low);
      font: var(--app-label-medium);
      text-align: center;
    }
  `,
})
export class ShortcutsDialogComponent {
  protected readonly ref = inject(DialogRef);
  protected readonly groups = GROUPS;
}
