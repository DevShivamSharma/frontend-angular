import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';
import { NewRecipientList, RecipientList, RecipientListView } from './email-recipients.models';

/** Who each email goes to: the lists, by slug, and the people on them (ITPO staff). */
@Injectable({ providedIn: 'root' })
export class EmailRecipientsApiService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_CONFIG).ems}/email-recipients`;

  lists(): Observable<RecipientList[]> {
    return this.http.get<RecipientList[]>(this.url);
  }

  list(slug: string): Observable<RecipientListView> {
    return this.http.get<RecipientListView>(`${this.url}/${slug}`);
  }

  createList(list: NewRecipientList): Observable<RecipientListView> {
    return this.http.post<RecipientListView>(this.url, list);
  }

  setListActive(slug: string, active: boolean): Observable<RecipientListView> {
    return this.http.patch<RecipientListView>(`${this.url}/${slug}`, { active });
  }

  deleteList(slug: string): Observable<null> {
    return this.http.delete<null>(`${this.url}/${slug}`);
  }

  addPerson(slug: string, email: string, name: string): Observable<RecipientListView> {
    return this.http.post<RecipientListView>(`${this.url}/${slug}/people`, {
      email,
      ...(name.trim() && { name: name.trim() }),
    });
  }

  setPersonActive(slug: string, id: string, active: boolean): Observable<RecipientListView> {
    return this.http.patch<RecipientListView>(`${this.url}/${slug}/people/${id}`, { active });
  }

  removePerson(slug: string, id: string): Observable<RecipientListView> {
    return this.http.delete<RecipientListView>(`${this.url}/${slug}/people/${id}`);
  }
}
