import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { ColorScheme, ColorSchemeService } from '../core/theme/color-scheme.service';

const OPTIONS: Array<{ value: ColorScheme; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: 'pi-sun' },
  { value: 'dark', label: 'Dark', icon: 'pi-moon' },
  { value: 'system', label: 'As the device', icon: 'pi-desktop' },
];

/** Light, dark or as the device is: a button in the top bar with the three to choose from. */
@Component({
  selector: 'app-theme-toggle',
  imports: [ButtonModule, PopoverModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      pButton
      [text]="true"
      [rounded]="true"
      severity="secondary"
      (click)="menu.toggle($event)"
      aria-haspopup="menu"
      [attr.aria-label]="'Theme: ' + current().label"
      pTooltip="Theme"
      tooltipPosition="bottom"
    >
      <i class="pi" [class]="'pi ' + current().icon" aria-hidden="true"></i>
    </button>
    <p-popover #menu>
      <div class="menu" role="menu" aria-label="Theme">
        @for (o of options; track o.value) {
          <button
            type="button"
            class="menu-item"
            role="menuitemradio"
            [attr.aria-checked]="schemes.scheme() === o.value"
            (click)="choose(o.value); menu.hide()"
          >
            <i class="pi" [class]="'pi ' + o.icon" aria-hidden="true"></i>
            <span class="label">{{ o.label }}</span>
            @if (schemes.scheme() === o.value) {
              <i class="pi pi-check tick" aria-hidden="true"></i>
            }
          </button>
        }
      </div>
    </p-popover>
  `,
  styles: `
    .menu {
      display: grid;
      min-width: 190px;
    }
    .label {
      flex: 1;
      text-align: left;
    }
    .tick {
      color: var(--app-primary);
    }
  `,
})
export class ThemeToggleComponent {
  protected readonly schemes = inject(ColorSchemeService);
  protected readonly options = OPTIONS;
  /** The choice; "As the device" shows the sun or moon the device is on. */
  protected readonly current = computed(() => {
    const scheme = this.schemes.scheme();
    const chosen = OPTIONS.find((o) => o.value === scheme)!;
    return scheme === 'system'
      ? { ...chosen, icon: this.schemes.dark() ? 'pi-moon' : 'pi-sun' }
      : chosen;
  });

  protected choose(scheme: ColorScheme): void {
    this.schemes.set(scheme);
  }
}
