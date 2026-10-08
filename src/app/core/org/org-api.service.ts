import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';
import { quiet } from '../api/error-toast.interceptor';
import type {
  AssignableRoleView,
  AuditEntry,
  ConfigVersion,
  CreatedInvitation,
  InvitationPreview,
  InvitationView,
  MemberView,
  OrganisationConfig,
  OrgContext,
  OrgSettings,
  Page,
  PublicConfig,
} from '../api/api.models';

/** Calls about one organisation, as a member (or before signing in, for its public look). */
@Injectable({ providedIn: 'root' })
export class OrgApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  private org(slug: string): string {
    return `${this.api}/orgs/${encodeURIComponent(slug)}`;
  }

  /** A 404 is the invalid-link page, shown by the organisation guard. */
  publicConfig(slug: string): Observable<PublicConfig> {
    return this.http.get<PublicConfig>(`${this.org(slug)}/public-config`, quiet(404));
  }

  /** 403 and 404 become the no-access and invalid-link pages, by the member guard. */
  context(slug: string): Observable<OrgContext> {
    return this.http.get<OrgContext>(`${this.org(slug)}/context`, quiet(403, 404));
  }

  members(slug: string): Observable<MemberView[]> {
    return this.http.get<MemberView[]>(`${this.org(slug)}/members`);
  }

  changeRole(slug: string, membershipId: string, roleId: string): Observable<MemberView> {
    return this.http.patch<MemberView>(`${this.org(slug)}/members/${membershipId}`, { roleId });
  }

  removeMember(slug: string, membershipId: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/members/${membershipId}`);
  }

  roles(slug: string): Observable<AssignableRoleView[]> {
    return this.http.get<AssignableRoleView[]>(`${this.org(slug)}/roles`);
  }

  invitations(slug: string): Observable<InvitationView[]> {
    return this.http.get<InvitationView[]>(`${this.org(slug)}/invitations`);
  }

  invite(slug: string, email: string, roleId: string): Observable<CreatedInvitation> {
    return this.http.post<CreatedInvitation>(`${this.org(slug)}/invitations`, { email, roleId });
  }

  resendInvitation(slug: string, invitationId: string): Observable<CreatedInvitation> {
    return this.http.post<CreatedInvitation>(
      `${this.org(slug)}/invitations/${invitationId}/resend`,
      {},
    );
  }

  revokeInvitation(slug: string, invitationId: string): Observable<void> {
    return this.http.delete<void>(`${this.org(slug)}/invitations/${invitationId}`);
  }

  settings(slug: string): Observable<OrgSettings> {
    return this.http.get<OrgSettings>(`${this.org(slug)}/settings`);
  }

  saveConfig(slug: string, config: OrganisationConfig): Observable<OrgSettings> {
    return this.http.put<OrgSettings>(`${this.org(slug)}/settings/config`, config);
  }

  configVersions(slug: string): Observable<ConfigVersion[]> {
    return this.http.get<ConfigVersion[]>(`${this.org(slug)}/settings/config/versions`);
  }

  restoreConfig(slug: string, version: number): Observable<OrgSettings> {
    return this.http.post<OrgSettings>(
      `${this.org(slug)}/settings/config/versions/${version}/restore`,
      {},
    );
  }

  audit(slug: string, page: number, pageSize: number): Observable<Page<AuditEntry>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<Page<AuditEntry>>(`${this.org(slug)}/audit`, { params });
  }

  invitationPreview(token: string): Observable<InvitationPreview> {
    return this.http.get<InvitationPreview>(
      `${this.api}/auth/invitations/${encodeURIComponent(token)}`,
    );
  }

  forgotPassword(email: string, orgSlug?: string): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/forgot-password`, {
      email,
      ...(orgSlug ? { orgSlug } : {}),
    });
  }

  resetPassword(token: string, password: string): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/reset-password`, { token, password });
  }
}
