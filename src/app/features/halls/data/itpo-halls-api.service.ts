import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import {
  HallCategory,
  HallImage,
  HallListQuery,
  HallResource,
  ItpoHall,
  Page,
} from './halls.models';

/** Raw shapes of ITPO's answers, kept here so the rest of the app sees clean models. */
interface RawHallPage {
  list: Record<string, unknown>[];
  total: number;
  page: number;
  size: number;
}

interface RawCategoryList {
  list: { id: number; categoryName?: string; category_name?: string; name?: string }[];
}

/** ITPO's admin service: the list of halls SelfCare shows, and the hall categories. */
@Injectable({ providedIn: 'root' })
export class ItpoHallsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = inject(API_CONFIG).itpoAdmin;

  halls(query: HallListQuery): Observable<Page<ItpoHall>> {
    let params = new HttpParams().set('page', query.page).set('size', query.size);
    if (query.search) {
      params = params.set('search', query.search);
    }
    return this.http.get<RawHallPage>(`${this.url}/halls`, { params }).pipe(
      map((raw) => ({
        items: raw.list.map(toHall),
        total: raw.total,
        page: raw.page,
        size: raw.size,
      })),
    );
  }

  /** One hall, with its pictures. */
  hall(id: number): Observable<ItpoHall> {
    return this.http.get<Record<string, unknown>>(`${this.url}/halls/id/${id}`).pipe(map(toHall));
  }

  categories(): Observable<HallCategory[]> {
    return this.http.get<RawCategoryList>(`${this.url}/category/halls`).pipe(
      map((raw) =>
        raw.list.map((c) => ({
          id: c.id,
          name: c.categoryName ?? c.category_name ?? c.name ?? `Category ${c.id}`,
        })),
      ),
    );
  }
}

function toHall(raw: Record<string, unknown>): ItpoHall {
  const category = raw['hallCategory'] as Record<string, unknown> | null | undefined;
  return {
    id: Number(raw['id']),
    name: String(raw['name'] ?? ''),
    description: (raw['description'] as string | null | undefined) ?? null,
    hallAreaCapacity:
      raw['hallAreaCapacity'] === null || raw['hallAreaCapacity'] === undefined
        ? null
        : Number(raw['hallAreaCapacity']),
    hallCategory: category
      ? {
          id: Number(category['id']),
          name: String(
            category['categoryName'] ?? category['category_name'] ?? category['name'] ?? '',
          ),
        }
      : null,
    isVipLounge: raw['isVipLounge'] === true,
    isAvailableForFnB: raw['isAvailableForFnB'] === true,
    complementaryDays:
      raw['complementaryDays'] === null || raw['complementaryDays'] === undefined
        ? null
        : Number(raw['complementaryDays']),
    sortOrder:
      raw['sortOrder'] === null || raw['sortOrder'] === undefined ? null : Number(raw['sortOrder']),
    isActive: raw['isActive'] !== false,
    isPopular: raw['isPopular'] === true,
    isAvailableForBooking: raw['isAvailableForBooking'] !== false,
    hallCode:
      raw['hallCode'] === null || raw['hallCode'] === undefined ? null : Number(raw['hallCode']),
    hallIncharge: text(raw['hallIncharge']),
    financeOfficer: text(raw['financeOfficer']),
    images: list(raw['imageHall'])
      .map(toImage)
      .filter((image): image is HallImage => !!image),
    resources: list(raw['resources']).map(toResource),
    createdAt: text(raw['createdAt']),
    updatedAt: text(raw['updatedAt']),
    raw,
  };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

/** A document ITPO lists for the hall; one with no URL has nothing to show. */
function toImage(raw: Record<string, unknown>): HallImage | null {
  const url = text(raw['documentUrl']);
  return url
    ? {
        documentId: Number(raw['documentId']),
        name: text(raw['documentName']) ?? '',
        url,
        kind: raw['documentType'] === 'cover' ? 'cover' : 'gallery',
      }
    : null;
}

function toResource(raw: Record<string, unknown>): HallResource {
  return {
    name: String(raw['name'] ?? ''),
    type: String(raw['type'] ?? ''),
    description: text(raw['description']),
  };
}
