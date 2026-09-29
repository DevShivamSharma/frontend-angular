import { ChangeDetectionStrategy, Component, computed, DestroyRef, DOCUMENT, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { SetupState } from './setup-state.service';

interface Step {
  n: number;
  title: string;
  hint: string;
  path: string | null;
}

/**
 * The frame of the stall-planner setup: ITPO sidebar with the three steps, top bar and the
 * lavender content panel. Steps render in the router outlet.
 */
@Component({
  selector: 'app-setup-shell',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './setup-shell.component.html',
  styleUrl: './setup-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SetupShellComponent {
  private readonly router = inject(Router);
  readonly state = inject(SetupState);

  constructor() {
    // Popups mount on <body>, outside this shell: give them the ITPO accent while it is shown.
    const body = inject(DOCUMENT).body;
    body.classList.add('theme-itpo');
    inject(DestroyRef).onDestroy(() => body.classList.remove('theme-itpo'));
  }

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  readonly steps: Step[] = [
    { n: 1, title: 'Select hall', hint: 'Choose or import a hall', path: '/planner/halls' },
    { n: 2, title: 'Plotting rules', hint: 'Rules stalls must follow', path: '/planner/rules' },
    { n: 3, title: 'Plan stalls', hint: 'Draw stalls on the hall', path: '/planner/draft' }
  ];

  readonly current = computed(() => (this.url().startsWith('/planner/rules') ? 2 : 1));
  readonly pageTitle = computed(() => {
    const url = this.url();
    if (url.startsWith('/planner/halls/import')) return 'Import a hall';
    return this.steps[this.current() - 1].title;
  });

  /** Steps 2 and 3 need a hall. */
  isAvailable(step: Step): boolean {
    return step.n === 1 || this.state.hallId() !== null;
  }

  /** Step 2 is addressed by hall id; step 1's `?hall=` means a venue hall NUMBER, so none there. */
  queryFor(step: Step): Record<string, string> | null {
    const hall = this.state.hallId();
    if (!hall || step.n === 1) return null;
    return step.n === 2 ? { hall } : { hallId: hall };
  }
}
