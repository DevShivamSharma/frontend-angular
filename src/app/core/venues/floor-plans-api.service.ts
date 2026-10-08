import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { API_BASE_URL } from '../api/api-base.token';
import type { HallFloor } from '../api/api.models';
import type {
  CommitResult,
  CommitSelection,
  MultiPolygon,
  PlanPage,
  PlanReview,
  PlanView,
} from './floor-plan.models';
export interface PlanPreview {
  floor: HallFloor | null;
  review: PlanReview;
  config: unknown;
  diff: {
    added: MultiPolygon;
    removed: MultiPolygon;
    addedArea: number;
    removedArea: number;
    iou: number;
    alignment: string;
  } | null;
}
@Injectable({ providedIn: 'root' })
export class FloorPlansApi {
  private http = inject(HttpClient);
  private base = inject(API_BASE_URL);
  private url(org: string, venue: string, id = '') {
    return `${this.base}/orgs/${encodeURIComponent(org)}/venues/${venue}/floor-plans${id ? '/' + id : ''}`;
  }
  upload(org: string, venue: string, file: File, fresh = false) {
    const data = new FormData();
    data.append('file', file);
    return this.http.post<{ id: string }>(
      this.url(org, venue) + (fresh ? '?fresh=true' : ''),
      data,
    );
  }
  get(org: string, venue: string, id: string) {
    return this.http.get<PlanView>(this.url(org, venue, id));
  }
  edit(org: string, venue: string, id: string, revision: number, page: PlanPage) {
    const { number, regions, objects, grid, calibration, dimensions, annotations } = page;
    return this.http.patch<PlanView>(this.url(org, venue, id), {
      revision,
      page: number,
      regions,
      objects,
      grid,
      calibration,
      dimensions,
      ...(annotations ? { annotations } : {}),
    });
  }
  preview(org: string, venue: string, id: string, key: string, target = '') {
    let params = new HttpParams().set('key', key);
    if (target) params = params.set('target', target);
    return this.http.get<PlanPreview>(this.url(org, venue, id) + '/preview', { params });
  }
  commit(org: string, venue: string, id: string, revision: number, selections: CommitSelection[]) {
    return this.http.post<CommitResult[]>(this.url(org, venue, id) + '/commit', {
      revision,
      selections,
    });
  }
}
