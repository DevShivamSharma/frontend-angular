import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type {
  CategoryImportResult,
  CategoryInput,
  CategoryStatus,
  CategoryView,
} from './categories.models';

/** The organisation's master list of stall categories. */
@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private base(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}/categories`;
  }

  list(slug: string): Observable<CategoryView[]> {
    return this.http.get<CategoryView[]>(this.base(slug));
  }

  create(slug: string, input: CategoryInput): Observable<CategoryView> {
    return this.http.post<CategoryView>(this.base(slug), input);
  }

  update(
    slug: string,
    id: string,
    input: { name?: string; status?: CategoryStatus },
  ): Observable<CategoryView> {
    return this.http.patch<CategoryView>(`${this.base(slug)}/${id}`, input);
  }

  delete(slug: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.base(slug)}/${id}`);
  }

  import(slug: string, rows: CategoryInput[]): Observable<CategoryImportResult> {
    return this.http.post<CategoryImportResult>(`${this.base(slug)}/import`, { rows });
  }
}
