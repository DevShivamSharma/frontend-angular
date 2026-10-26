import { inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

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

  /** Puts these in the address; an empty value (or page 1) leaves the address clean. */
  write(values: Record<string, string | number | null | undefined>): void {
    const queryParams = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        v === '' || v === 1 || v === undefined ? null : v,
      ]),
    );
    void this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
