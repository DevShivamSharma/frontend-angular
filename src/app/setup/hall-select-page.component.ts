import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { extractErrorMessage } from '../core/http-error.util';
import { NotifyService } from '../core/notify.service';
import { Hall } from '../planner/models/hall.model';
import { findVenueHall, parseHallIdentity } from '../shared/hall-identity';
import { amenityInfo } from './amenity-kinds';
import { HallThumbnailComponent } from './hall-thumbnail.component';
import { SetupApiService } from './setup-api.service';
import { SetupState } from './setup-state.service';

interface HallCard {
  hall: Hall;
  id: string;
  floor: string | null;
  size: string;
  area: string;
  facilities: string[];
}

/**
 * Step 1: choose the hall to plan, or import a new one from its floor plan.
 *
 * Query parameters: `?hall=11&floor=GF` (the venue map's "Go to stall planner", a hall NUMBER)
 * and `?selected=<id>` (a hall just imported) preselect a hall.
 */
@Component({
  selector: 'app-hall-select-page',
  imports: [RouterLink, HallThumbnailComponent],
  templateUrl: './hall-select-page.component.html',
  styleUrl: './hall-select-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HallSelectPageComponent implements OnInit {
  private readonly api = inject(SetupApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  readonly state = inject(SetupState);
  /** Id of the hall being deleted, so its card shows it and cannot be deleted twice. */
  readonly deleting = signal<string | null>(null);

  readonly halls = signal<Hall[]>([]);
  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly error = signal('');
  readonly query = signal('');
  /** A note shown when the selection came from elsewhere (venue map, a fresh import). */
  readonly notice = signal('');

  readonly cards = computed<HallCard[]>(() => this.halls().map(toCard));
  readonly filtered = computed(() => {
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.cards();
    return this.cards().filter(card => words.every(w => card.hall.name.toLowerCase().includes(w)));
  });
  readonly selected = computed(() => this.cards().find(card => card.id === this.state.hallId()) ?? null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.status.set('loading');
    try {
      const halls = await this.api.listHalls();
      this.halls.set([...halls].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
      this.status.set('ready');
      this.applyQuery();
    } catch (e) {
      this.error.set(extractErrorMessage(e));
      this.status.set('error');
    }
  }

  select(card: HallCard): void {
    this.state.select(card.id);
  }

  /** For an import that went wrong: removes the hall after an explicit confirmation. */
  async remove(card: HallCard): Promise<void> {
    if (this.deleting()) return;
    const confirmed = await this.notify.confirm({
      title: `Delete ${card.hall.name}?`,
      text: 'The hall and its imported plan are removed, and plotting rules no longer list it. Saved layouts are not affected. This cannot be undone.',
      confirmText: 'Delete hall',
      danger: true
    });
    if (!confirmed) return;
    this.deleting.set(card.id);
    try {
      await this.api.deleteHall(card.id);
      this.halls.update(list => list.filter(h => String(h.id) !== card.id));
      if (this.state.hallId() === card.id) this.state.select(null);
      this.notice.set('');
      this.notify.success(`${card.hall.name} deleted`);
    } catch (e) {
      this.notify.error('The hall could not be deleted', extractErrorMessage(e));
    } finally {
      this.deleting.set(null);
    }
  }

  next(): void {
    const card = this.selected();
    if (!card) return;
    void this.router.navigate(['/planner/rules'], { queryParams: { hall: card.id } });
  }

  private applyQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const selected = params.get('selected');
    const venueNumber = params.get('hall');
    let pick: Hall | undefined;
    if (selected) {
      pick = this.halls().find(h => String(h.id) === selected);
      if (pick) this.notice.set(`${pick.name} was imported and is selected.`);
    } else if (venueNumber) {
      pick = findVenueHall(this.halls(), venueNumber, params.get('floor'));
      this.notice.set(
        pick
          ? `${pick.name} is selected from the venue map.`
          : `Hall ${venueNumber} has not been imported yet. Import its floor plan to plan stalls in it.`
      );
    }
    if (pick) this.state.select(pick.id);
    // A remembered choice that no longer exists is dropped.
    if (this.state.hallId() && !this.selected()) this.state.select(null);
  }
}

function toCard(hall: Hall): HallCard {
  const area = hall.boundary?.length ? polygonArea(hall.boundary) : hall.width * hall.length;
  const counts = new Map<string, number>();
  for (const a of hall.amenities ?? []) {
    const group = amenityInfo(a.kind).group;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const facilities: string[] = [];
  const add = (group: string, one: string, many: string) => {
    const n = counts.get(group);
    if (n) facilities.push(`${n} ${n === 1 ? one : many}`);
  };
  add('Entries & exits', 'entry / exit', 'entries & exits');
  add('Toilets', 'toilet', 'toilets');
  add('Lifts & stairs', 'lift / stair', 'lifts & stairs');
  return {
    hall,
    id: String(hall.id),
    floor: parseHallIdentity(hall.name)?.floor ?? null,
    size: `${fmt(hall.width)} × ${fmt(hall.length)} m`,
    area: `${Math.round(area).toLocaleString('en-IN')} m²`,
    facilities
  };
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('en-IN');
}

function polygonArea(points: Array<{ x: number; z: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}
