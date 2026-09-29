import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { stallArea, stallSizeText } from '../geometry/footprint-view';
import type { GateSide, Stall } from '../models/stall.model';
import { fmt, parseSize } from './draft-frame';
import { DraftingService } from './drafting.service';

const PALETTE_STYLES = `
  :host { display: flex; flex-direction: column; gap: 10px; padding: 10px; overflow-y: auto; background: #252b36; color: #d6dbe3; font: 12px system-ui, sans-serif; }
  h3 { margin: 0 0 6px; font-size: 10.5px; letter-spacing: .08em; color: #8391a5; font-weight: 700; }
  select, input { width: 100%; box-sizing: border-box; background: #1b2029; color: #e5e7eb; border: 1px solid #3a4354; border-radius: 4px; padding: 4px 6px; font: inherit; }
  .row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .row > span:first-of-type { flex: 1; }
  button { font: inherit; color: inherit; background: #313a4a; border: 1px solid #434d60; border-radius: 4px; padding: 3px 7px; cursor: pointer; }
  button.on { background: #1e40af; border-color: #3b82f6; color: #fff; }
  .muted { color: #8391a5; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; }
  dt { color: #8391a5; }
  dd { margin: 0; text-align: right; }
`;

/** Left palette: the hall and layout being drawn, layers, and stall types. */
@Component({
  selector: 'app-draft-left-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h3>HALL</h3>
      <select aria-label="Hall" (change)="setHall($any($event.target).value); $any($event.target).blur()">
        @for (h of draft.store.halls(); track h.id) {
          <option [value]="h.id" [selected]="'' + h.id === '' + draft.store.activeHallId()">{{ h.name }}</option>
        }
      </select>
    </section>
    <section>
      <h3>LAYOUT</h3>
      <select aria-label="Open a saved layout" (change)="open($any($event.target).value); $any($event.target).blur()">
        <option value="">{{ draft.store.selectedSavedId() === null ? 'Unsaved layout' : 'Open another…' }}</option>
        @for (l of draft.store.savedLayouts(); track l.id) {
          <option [value]="l.id" [selected]="'' + l.id === '' + draft.store.selectedSavedId()">#{{ l.id }} {{ l.name }}</option>
        }
      </select>
    </section>
    <section>
      <h3>LAYERS</h3>
      <div class="row"><span>Hall base</span><span class="muted" title="Reference layer: it cannot be edited here">🔒</span>
        <button type="button" [class.on]="draft.layers().base" (click)="layer('base')" aria-label="Show hall base">{{ draft.layers().base ? 'On' : 'Off' }}</button></div>
      <div class="row"><span>Stalls</span>
        <button type="button" [class.on]="draft.layers().stalls" (click)="layer('stalls')" aria-label="Show stalls">{{ draft.layers().stalls ? 'On' : 'Off' }}</button></div>
      <div class="row"><span>Stall numbers</span>
        <button type="button" [class.on]="draft.layers().labels" (click)="layer('labels')" aria-label="Show stall numbers">{{ draft.layers().labels ? 'On' : 'Off' }}</button></div>
      <div class="row"><span>Grid (F7)</span>
        <button type="button" [class.on]="draft.toggles().grid" (click)="draft.toggle('grid')" aria-label="Show grid">{{ draft.toggles().grid ? 'On' : 'Off' }}</button></div>
    </section>
    <section>
      <h3>STALL TYPE</h3>
      <div class="types">
        @for (t of types(); track t) {
          <button type="button" [class.on]="t === current()" (click)="setSize(t)">{{ t }}</button>
        }
      </div>
      <input aria-label="Custom stall size" placeholder="Custom, e.g. 4.5x3" (change)="custom($any($event.target))" />
      <p class="muted">Used by STL and SR. Type another size at their prompt.</p>
    </section>
  `,
  styles: PALETTE_STYLES + `.types { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; } p { margin: 6px 0 0; }`,
})
export class DraftLeftPaletteComponent {
  readonly draft = inject(DraftingService);
  readonly current = computed(() => this.draft.size().join('×'));
  readonly types = computed(() => {
    const list = ['3×2', '3×3', '4×3', '6×3', '9×6'];
    for (const t of this.draft.store.stallTypes()) {
      const key = `${t.width}×${t.height}`;
      if (!list.includes(key)) list.push(key);
    }
    return list;
  });

  /** The option's value is a string; the store keeps the hall's own id (numeric from the server). */
  setHall(value: string): void {
    const hall = this.draft.store.halls().find(h => String(h.id) === value);
    if (hall) this.draft.store.setActiveHall(hall.id);
  }

  layer(name: 'base' | 'stalls' | 'labels'): void {
    this.draft.layers.update(l => ({ ...l, [name]: !l[name] }));
  }

  setSize(t: string): void {
    const size = parseSize(t.replace('×', 'x'));
    if (size) this.draft.size.set(size);
  }

  custom(el: HTMLInputElement): void {
    const size = parseSize(el.value);
    if (size) {
      this.draft.size.set(size);
      el.value = '';
    }
  }

  open(id: string): void {
    if (id) void this.draft.store.openLayout(id);
  }
}

const SIDES: GateSide[] = ['FRONT', 'BACK', 'LEFT', 'RIGHT'];

/** Right palette: properties of the selection and its rule check, or the drawing's statement. */
@Component({
  selector: 'app-draft-properties',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selected(); as sel) {
      @if (sel.length === 1) {
        @let s = sel[0];
        <section>
          <h3>PROPERTIES · 1 STALL</h3>
          <label class="muted" for="draft-name">Name</label>
          <input id="draft-name" [value]="s.name" (change)="rename(s, $any($event.target).value)" />
          <dl>
            <dt>Number</dt><dd>{{ s.stallNumber ?? 'on save' }}</dd>
            <dt>Size</dt><dd>{{ size(s) }}</dd>
            <dt>Area</dt><dd>{{ area(s) }} m²</dd>
            <dt>Rotation</dt><dd>{{ s.rotation ?? 0 }}°</dd>
            <dt>Status</dt><dd>{{ s.status }}</dd>
          </dl>
        </section>
        @if (!s.footprint?.length) {
          <section>
            <h3>OPEN SIDES</h3>
            <div class="sides">
              @for (side of sides; track side) {
                <button type="button" [class.on]="s.openSides.includes(side)" (click)="toggleSide(s, side)">{{ side }}</button>
              }
            </div>
          </section>
        }
      } @else {
        <section>
          <h3>PROPERTIES · {{ sel.length }} STALLS</h3>
          <dl><dt>Total area</dt><dd>{{ totalArea(sel) }} m²</dd></dl>
        </section>
      }
      <section>
        <h3>RULE CHECK</h3>
        @for (m of selectionIssues(); track $index) { <p class="issue">{{ m }}</p> }
        @empty { <p class="ok">No rule issues.</p> }
      </section>
    } @else {
      <section>
        <h3>DRAWING</h3>
        <dl>
          <dt>Hall</dt><dd>{{ draft.hall()?.name ?? '—' }}</dd>
          <dt>Stalls</dt><dd>{{ statement().count }}</dd>
          <dt>Stall area</dt><dd>{{ statement().area }} m²</dd>
          <dt>Rule issues</dt><dd [class.bad]="statement().issues">{{ statement().issues }}</dd>
          <dt>Size step</dt><dd>{{ statement().step }} m</dd>
        </dl>
      </section>
      <section>
        <h3>AREA STATEMENT</h3>
        <dl>
          @for (r of statement().bySize; track r.size) { <dt>{{ r.size }}</dt><dd>{{ r.count }} × = {{ r.area }} m²</dd> }
        </dl>
      </section>
      <p class="muted">Select stalls to see their properties. Click, or drag a window (left to right) or crossing (right to left).</p>
    }
  `,
  styles: PALETTE_STYLES + `
    .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .issue { margin: 4px 0; padding: 6px; border-radius: 4px; background: #3b1f24; color: #fecaca; line-height: 1.35; }
    .ok { color: #86efac; margin: 0; }
    .bad { color: #fca5a5; }
    label { display: block; margin-bottom: 3px; }
    #draft-name { margin-bottom: 8px; }
  `,
})
export class DraftPropertiesComponent {
  readonly draft = inject(DraftingService);
  readonly sides = SIDES;
  readonly selected = computed(() => {
    this.draft.version();
    const sel = this.draft.engine.selectedStalls();
    return sel.length ? sel : null;
  });
  readonly selectionIssues = computed(() => {
    const issues = this.draft.issues();
    return (this.selected() ?? []).flatMap(s => (issues.get(String(s.id)) ?? []).map(m => (this.selected()!.length > 1 ? `${s.name}: ${m}` : m)));
  });
  readonly statement = computed(() => {
    this.draft.version();
    const live = this.draft.engine.stalls.filter(s => s.status !== 'CANCELLED');
    const bySize = new Map<string, { count: number; area: number }>();
    for (const s of live) {
      const key = stallSizeText(s);
      const e = bySize.get(key) ?? { count: 0, area: 0 };
      e.count++;
      e.area += stallArea(s);
      bySize.set(key, e);
    }
    return {
      count: live.length,
      area: fmt(live.reduce((a, s) => a + stallArea(s), 0), 1),
      issues: this.draft.issues().size,
      step: this.draft.grid()?.snapStep ?? 1,
      bySize: [...bySize].sort((a, b) => b[1].count - a[1].count).map(([size, e]) => ({ size, count: e.count, area: fmt(e.area, 1) })),
    };
  });

  size(s: Stall): string {
    return stallSizeText(s);
  }

  area(s: Stall): string {
    return fmt(stallArea(s), 2);
  }

  totalArea(list: Stall[]): string {
    return fmt(list.reduce((a, s) => a + stallArea(s), 0), 1);
  }

  rename(s: Stall, name: string): void {
    const n = name.trim();
    if (n && n !== s.name) this.draft.editStalls('RENAME', x => ({ ...x, name: n }), [String(s.id)]);
  }

  toggleSide(s: Stall, side: GateSide): void {
    const has = s.openSides.includes(side);
    const next = has ? s.openSides.filter(x => x !== side) : [...s.openSides, side];
    if (!next.length) return; // a stall keeps at least one open side
    this.draft.editStalls('OPEN SIDES', x => ({ ...x, openSides: next, gateSide: next[0] }), [String(s.id)]);
  }
}
