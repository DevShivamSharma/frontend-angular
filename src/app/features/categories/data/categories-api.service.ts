import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import { Page } from '../../halls/data/halls.models';
import { slugOf } from '../domain/category-groups';
import { Category, CategoryGroup, CategoryQuery, NewCategory } from './categories.models';

type Raw = Record<string, unknown>;

interface RawPage {
  list: Raw[];
  total: number;
  page: number;
  size: number;
}

/** ITPO's admin service: its code master, where the product categories are kept. */
@Injectable({ providedIn: 'root' })
export class CategoriesApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).itpoAdmin}/admin/master`;

  /** Every group ITPO keeps; the ones that hold categories are told apart by `categoryGroups`. */
  groups(): Observable<CategoryGroup[]> {
    const params = new HttpParams().set('page', 1).set('size', 200).set('status', 'all');
    return this.http.get<RawPage>(`${this.url}/types`, { params }).pipe(
      map((raw) =>
        raw.list.map((g) => ({
          id: Number(g['id']),
          name: String(g['name']),
          slug: String(g['slug']),
        })),
      ),
    );
  }

  list(query: CategoryQuery): Observable<Page<Category>> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('size', query.size)
      .set('status', query.status === 'all' ? 'all' : query.status === 'active' ? 'true' : 'false');
    if (query.search) {
      params = params.set('search', query.search);
    }
    return this.http
      .get<RawPage>(`${this.url}/types/list/${encodeURIComponent(query.group)}`, { params })
      .pipe(
        map((raw) => ({
          items: raw.list.map(toCategory),
          total: raw.total,
          page: raw.page,
          size: raw.size,
        })),
      );
  }

  create(group: string, category: NewCategory): Observable<Category> {
    return this.http
      .post<Raw>(`${this.url}/types/code-master/${encodeURIComponent(group)}`, {
        name: category.name.trim(),
        slug: slugOf(category.name),
        ...(category.description?.trim() && { description: category.description.trim() }),
        status: true,
      })
      .pipe(map(toCategory));
  }

  setActive(id: number, active: boolean): Observable<Category> {
    return this.http
      .patch<Raw>(`${this.url}/code-master/update/${id}`, { status: active })
      .pipe(map(toCategory));
  }
}

function toCategory(raw: Raw): Category {
  return {
    id: Number(raw['id']),
    name: String(raw['name'] ?? ''),
    slug: String(raw['slug'] ?? ''),
    description:
      typeof raw['description'] === 'string' && raw['description'] ? raw['description'] : null,
    active: raw['status'] !== false,
  };
}
