import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import { HallLayout, LayoutArea, parseLayout, toLayoutData } from '../domain/hall-layout';
import { HallNotes, toNotesFields } from '../domain/hall-notes';

/** ITPO's stall service: the layout of a hall (its grid, and what on it cannot be used). */
@Injectable({ providedIn: 'root' })
export class ItpoLayoutApiService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(API_CONFIG).itpoStall;

  /** The hall's layout; null when it has none. */
  layout(hallId: number): Observable<HallLayout | null> {
    return this.http
      .get<unknown>(`${this.url}/hall-layouts/${hallId}`)
      .pipe(map((raw) => parseLayout(raw, hallId)));
  }

  /**
   * Saves the grid and the areas; ITPO keeps the rest of the layout as it is. The helpers, labels
   * and legend go only when they changed, so a save of the grid alone sends what it always did.
   */
  save(
    layout: HallLayout,
    grid: { columns: number; rows: number },
    areas: readonly LayoutArea[],
    notes?: HallNotes,
  ): Observable<unknown> {
    return this.http.put(`${this.url}/hall-layouts`, {
      hallId: layout.hallId,
      length: grid.columns,
      breadth: grid.rows,
      layout_data: toLayoutData(layout, areas),
      ...(notes ? toNotesFields(notes) : {}),
    });
  }
}
