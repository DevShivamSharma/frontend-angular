import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_CONFIG } from '../../../core/config/api-config';

/** A tool the model asked the planner to run. */
export interface AssistantToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
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
export class AssistantApiService {
  private readonly http = inject(HttpClient);
  private readonly ems = inject(API_CONFIG).ems;

  turn(eventId: string, hallId: string, messages: AssistantMessage[]): Observable<AssistantTurn> {
    return this.http.post<AssistantTurn>(
      `${this.ems}/events/${eventId}/halls/${hallId}/assistant`,
      { messages },
    );
  }
}
