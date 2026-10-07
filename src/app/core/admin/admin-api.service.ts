import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import type {
  AdminOverview,
  AdminRoleView,
  AuditEntry,
  BookingMode,
  ConfigVersion,
  CreatedInvitation,
  OrganisationConfig,
  OrganisationDetail,
  OrganisationFeatures,
  OrganisationLimits,
  OrganisationStatus,
  OrganisationSummary,
  OrganisationView,
  Page,
  PermissionGroup,
  RoleScopeKind,
  SlugCheck,
} from '../api/api.models';

export interface NewOrganisation {
  name: string;
  slug: string;
  primaryColor: string;
  bookingMode: BookingMode;
  features: OrganisationFeatures;
  limits: OrganisationLimits;
  firstAdmin: { email: string };
}

export interface RoleInput {
  organisationId?: string;
  key?: string;
  name: string;
  description: string | null;
  scopeKind: RoleScopeKind;
  permissions: string[];
}

/** The Super Admin console's calls. */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/admin`;

  overview(): Observable<AdminOverview> {
    return this.http.get<AdminOverview>(`${this.base}/overview`);
  }

  organisations(query: {
    q?: string;
    status?: OrganisationStatus | '';
    sort?: 'name' | 'newest';
    page: number;
    pageSize: number;
  }): Observable<Page<OrganisationSummary>> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    if (query.sort) params = params.set('sort', query.sort);
    return this.http.get<Page<OrganisationSummary>>(`${this.base}/organisations`, { params });
  }

  slugCheck(slug: string, organisationId?: string): Observable<SlugCheck> {
    let params = new HttpParams().set('slug', slug);
    if (organisationId) params = params.set('organisationId', organisationId);
    return this.http.get<SlugCheck>(`${this.base}/organisations/slug-check`, { params });
  }

  createOrganisation(
    input: NewOrganisation,
  ): Observable<{ organisation: OrganisationView; invitation: CreatedInvitation }> {
    return this.http.post<{ organisation: OrganisationView; invitation: CreatedInvitation }>(
      `${this.base}/organisations`,
      input,
    );
  }

  organisation(id: string): Observable<OrganisationDetail> {
    return this.http.get<OrganisationDetail>(`${this.base}/organisations/${id}`);
  }

  updateOrganisation(
    id: string,
    change: Partial<Pick<OrganisationView, 'name' | 'bookingMode' | 'features' | 'limits'>>,
  ): Observable<OrganisationView> {
    return this.http.patch<OrganisationView>(`${this.base}/organisations/${id}`, change);
  }

  changeSlug(id: string, slug: string): Observable<OrganisationView> {
    return this.http.put<OrganisationView>(`${this.base}/organisations/${id}/slug`, { slug });
  }

  suspend(id: string, reason: string): Observable<OrganisationView> {
    return this.http.post<OrganisationView>(`${this.base}/organisations/${id}/suspend`, { reason });
  }

  activate(id: string): Observable<OrganisationView> {
    return this.http.post<OrganisationView>(`${this.base}/organisations/${id}/activate`, {});
  }

  saveConfig(id: string, config: OrganisationConfig): Observable<OrganisationView> {
    return this.http.put<OrganisationView>(`${this.base}/organisations/${id}/config`, config);
  }

  configVersions(id: string): Observable<ConfigVersion[]> {
    return this.http.get<ConfigVersion[]>(`${this.base}/organisations/${id}/config/versions`);
  }

  invite(id: string, email: string, roleId?: string): Observable<CreatedInvitation> {
    return this.http.post<CreatedInvitation>(`${this.base}/organisations/${id}/invitations`, {
      email,
      ...(roleId ? { roleId } : {}),
    });
  }

  permissions(): Observable<PermissionGroup[]> {
    return this.http.get<PermissionGroup[]>(`${this.base}/permissions`);
  }

  roles(organisationId?: string): Observable<AdminRoleView[]> {
    const params = organisationId
      ? new HttpParams().set('organisationId', organisationId)
      : undefined;
    return this.http.get<AdminRoleView[]>(`${this.base}/roles`, { params });
  }

  role(id: string): Observable<AdminRoleView> {
    return this.http.get<AdminRoleView>(`${this.base}/roles/${id}`);
  }

  createRole(input: RoleInput): Observable<AdminRoleView> {
    return this.http.post<AdminRoleView>(`${this.base}/roles`, input);
  }

  updateRole(id: string, input: Partial<RoleInput>): Observable<AdminRoleView> {
    return this.http.patch<AdminRoleView>(`${this.base}/roles/${id}`, input);
  }

  deleteRole(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/roles/${id}`);
  }

  audit(query: {
    organisationId?: string;
    action?: string;
    page: number;
    pageSize: number;
  }): Observable<Page<AuditEntry>> {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.organisationId) params = params.set('organisationId', query.organisationId);
    if (query.action) params = params.set('action', query.action);
    return this.http.get<Page<AuditEntry>>(`${this.base}/audit`, { params });
  }
}
