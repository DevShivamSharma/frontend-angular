import { inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs';

/**
 * A list keeps its search and page in the address, so a reload, a shared link and the Back button
 * bring the same list back. Reading is once, on opening; writing replaces the entry (no history
 * entry per keystroke).
 */
export class UrlState {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  text(key: string): string {
    return this.route.snapshot.queryParamMap.get(key) ?? '';
  }

  /** A page number in the address as the row it starts at. */
  firstRow(key: string, pageSize: number): number {
    const page = Number(this.text(key));
    return Number.isInteger(page) && page > 1 ? (page - 1) * pageSize : 0;
  }

  /**
   * Puts these in the address; an empty value (or page 1) leaves the address clean. Nothing
   * happens when the address already says so: a page that writes as it opens would otherwise
   * start a second navigation that cancels the first, and the menu never learns which page opened.
   */
  write(values: Record<string, string | number | null | undefined>): void {
    const queryParams = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        v === '' || v === 1 || v === undefined ? null : v,
      ]),
    );
    const current = this.route.snapshot.queryParamMap;
    const same = Object.entries(queryParams).every(
      ([k, v]) => (current.get(k) ?? null) === (v === null ? null : String(v)),
    );
    if (same) return;

    const go = () =>
      void this.router.navigate([], {
        queryParams,
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    // A page opening writes from its constructor, while its own navigation is still running.
    if (this.router.getCurrentNavigation()) {
      this.router.events
        .pipe(
          filter((e) => e instanceof NavigationEnd),
          take(1),
        )
        .subscribe(go);
    } else {
      go();
    }
  }
}
