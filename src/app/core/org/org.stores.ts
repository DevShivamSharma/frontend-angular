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

  private readonly permissionSet = computed(() => new Set(this.context()?.permissions ?? []));

  can(permission: string): boolean {
    return this.permissionSet().has(permission);
  }
}
