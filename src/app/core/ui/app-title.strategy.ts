import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { PublicOrgStore } from '../org/org.stores';

/** "Team · Yashobhoomi" inside an organisation, "Roles · Platform admin" in the console. */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly org = inject(PublicOrgStore);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    const owner =
      this.org.config()?.name ??
      (snapshot.url.startsWith('/admin') ? 'Platform admin' : 'Venue platform');
    this.title.setTitle(page ? `${page} · ${owner}` : owner);
  }
}
