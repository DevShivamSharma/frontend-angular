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

  /**
   * The groups ITPO keeps: by default only the active ones, which is what every picker offers;
   * the group master passes `all` to also see the switched-off ones. The ones that hold
   * categories are told apart by `categoryGroups`.
   */
  groups(status: 'active' | 'all' = 'active'): Observable<CategoryGroup[]> {
    const params = new HttpParams()
      .set('page', 1)
      .set('size', 200)
      .set('status', status === 'all' ? 'all' : 'true');
    return this.http
      .get<RawPage>(`${this.url}/types`, { params })
      .pipe(map((raw) => raw.list.map(toGroup).filter((g) => status === 'all' || g.active)));
  }

  createGroup(group: NewCategory): Observable<CategoryGroup> {
    return this.http
      .post<Raw>(`${this.url}/types`, {
        name: group.name.trim(),
        slug: slugOf(group.name),
        ...(group.description?.trim() && { description: group.description.trim() }),
        status: true,
      })
      .pipe(map(toGroup));
  }

  setGroupActive(id: number, active: boolean): Observable<CategoryGroup> {
    return this.http
      .patch<Raw>(`${this.url}/types/update/${id}`, { status: active })
      .pipe(map(toGroup));
  }

  /** Removes a category from ITPO's master for good; deactivating is the way to keep it. */
  deleteCategory(id: number): Observable<void> {
    return this.http.delete(`${this.url}/code-master/delete/${id}`).pipe(map(() => undefined));
  }

  /** Removes a group for good. */
  deleteGroup(id: number): Observable<void> {
    return this.http.delete(`${this.url}/types/delete/${id}`).pipe(map(() => undefined));
  }

  /** How many categories a group holds, active or not. */
  categoryCount(group: string): Observable<number> {
    return this.list({ group, page: 1, size: 1, status: 'all' }).pipe(map((page) => page.total));
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

function toGroup(raw: Raw): CategoryGroup {
  return {
    id: Number(raw['id']),
    name: String(raw['name'] ?? ''),
    slug: String(raw['slug'] ?? ''),
    description:
      typeof raw['description'] === 'string' && raw['description'] ? raw['description'] : null,
    active: raw['status'] !== false,
  };
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
