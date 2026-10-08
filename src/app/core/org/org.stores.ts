import { computed, Injectable, signal } from '@angular/core';

import type { OrgContext, PublicConfig } from '../api/api.models';

/** The organisation the URL names, as anyone may see it: name and look. */
@Injectable({ providedIn: 'root' })
export class PublicOrgStore {
  readonly config = signal<PublicConfig | null>(null);
}

/** What the signed-in member may do in the current organisation. */
@Injectable({ providedIn: 'root' })
export class OrgContextStore {
  readonly context = signal<OrgContext | null>(null);
  readonly slug = computed(() => this.context()?.organisation.slug ?? '');

  /** An organiser: works only inside the events they were invited to. */
  readonly eventScoped = computed(() => this.context()?.membership.eventScoped ?? false);

  private readonly permissionSet = computed(() => new Set(this.context()?.permissions ?? []));

  /**
   * Whether the member may do this. An organiser's role may list more, but the server lets
   * them reach events only, so nothing else is offered.
   */
  can(permission: string): boolean {
    if (this.eventScoped() && !permission.startsWith('events.')) return false;
    return this.permissionSet().has(permission);
  }
}
