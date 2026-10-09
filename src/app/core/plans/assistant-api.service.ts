import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api-base.token';

/** A tool the model asked the planner to run. */
export interface AssistantToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque; sent back as it came. */
  signature?: string;
}

/**
 * One message of the conversation: the person's words (`user`), the model's words and the tools
 * it asked for (`assistant`), or what a tool did (`tool`, answering `callId`).
 */
export interface AssistantMessage {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  calls?: AssistantToolCall[];
  callId?: string;
  name?: string;
  result?: string;
}

/** The model's next move: words for the person, and tools to run first (maybe none). */
export interface AssistantTurn {
  text: string;
  calls: AssistantToolCall[];
}

/** The planner's AI assistant: one turn of the model, about one hall of an event. */
@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);

  turn(
    slug: string,
    eventId: string,
    hallId: string,
    messages: AssistantMessage[],
  ): Observable<AssistantTurn> {
    return this.http.post<AssistantTurn>(
      `${this.api}/orgs/${encodeURIComponent(slug)}/events/${eventId}/halls/${hallId}/assistant`,
      { messages },
    );
  }
}
