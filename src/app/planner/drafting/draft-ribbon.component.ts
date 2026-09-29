import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DraftingService } from './drafting.service';

interface Tool {
  label: string;
  alias: string;
  title: string;
}

interface Group {
  name: string;
  tools: Tool[];
}

/**
 * The ribbon, in AutoCAD's order: drawing tools first, then modify, layout, assist and view.
 * Every button shows the alias it runs, so the command line is learnt by using the buttons.
 */
@Component({
  selector: 'app-draft-ribbon',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <a class="brand" routerLink="/planner/editor" [queryParams]="{ hallId: draft.store.activeHallId() }" title="Back to the 3D stall editor">Stall planner · Drafting</a>
      <span class="doc" [title]="docName()">{{ docName() }}</span>
      <span class="spacer"></span>
      <button type="button" class="q" (click)="run('U')" [disabled]="!canUndo()" title="Undo (U, Ctrl+Z)">↶ Undo</button>
      <button type="button" class="q" (click)="run('REDO')" [disabled]="!canRedo()" title="Redo (REDO, Ctrl+Y)">↷ Redo</button>
      <button type="button" class="q save" (click)="run('SAVE')" [disabled]="draft.store.busy()" title="Save the layout (SAVE, Ctrl+S)">
        {{ draft.store.busy() ? 'Saving…' : 'Save' }}
      </button>
    </div>
    <div class="groups" role="toolbar" aria-label="Drafting tools">
      @for (g of groups; track g.name) {
        <div class="group">
          <div class="tools">
            @for (t of g.tools; track t.alias) {
              <button type="button" [class.on]="active() === t.alias" [title]="t.title + ' (' + t.alias + ')'" (click)="run(t.alias)">
                <span class="label">{{ t.label }}</span>
                <span class="alias">{{ t.alias }}</span>
              </button>
            }
          </div>
          <div class="gname">{{ g.name }}</div>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; background: #2a3140; color: #d6dbe3; border-bottom: 1px solid #3a4354; font: 12px system-ui, sans-serif; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid #3a4354; }
    .brand { color: #93c5fd; font-weight: 650; text-decoration: none; }
    .doc { color: #9aa4b2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
    .spacer { flex: 1; }
    button { font: inherit; color: inherit; background: none; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
    button:hover:not(:disabled) { background: #364055; border-color: #4a5569; }
    button:disabled { opacity: .45; cursor: default; }
    .q { padding: 3px 8px; }
    .save { background: #2563eb; color: #fff; }
    .save:hover:not(:disabled) { background: #1d4ed8; }
    .groups { display: flex; gap: 2px; padding: 4px 6px 0; overflow-x: auto; }
    .group { display: flex; flex-direction: column; border-right: 1px solid #3a4354; padding: 0 4px; }
    .tools { display: flex; gap: 2px; }
    .tools button { display: flex; flex-direction: column; align-items: center; min-width: 48px; padding: 4px 6px; }
    .tools button.on { background: #1e40af; border-color: #3b82f6; }
    .label { font-weight: 600; white-space: nowrap; }
    .alias { font: 10px ui-monospace, monospace; color: #93c5fd; }
    .gname { text-align: center; font-size: 10px; letter-spacing: .06em; color: #8391a5; padding: 2px 0 3px; }
  `,
})
export class DraftRibbonComponent {
  readonly draft = inject(DraftingService);
  /** After a tool starts, the canvas takes the pointer again. */
  readonly used = output<void>();

  readonly groups: Group[] = [
    { name: 'STALLS', tools: [
      { label: 'Stall', alias: 'STL', title: 'Place stalls one by one' },
      { label: 'Row', alias: 'SR', title: 'Fill a line with numbered stalls' },
    ] },
    { name: 'MODIFY', tools: [
      { label: 'Move', alias: 'M', title: 'Move' },
      { label: 'Copy', alias: 'CO', title: 'Copy' },
      { label: 'Rotate', alias: 'RO', title: 'Rotate' },
      { label: 'Erase', alias: 'E', title: 'Erase' },
    ] },
    { name: 'LAYOUT', tools: [
      { label: 'Number', alias: 'RN', title: 'Renumber stalls' },
      { label: 'Check', alias: 'CHK', title: 'Go through every rule issue' },
    ] },
    { name: 'ASSIST', tools: [
      { label: 'AI', alias: 'AI', title: 'Describe stalls in words' },
      { label: 'From PDF', alias: 'PP', title: 'Plot stalls from a CAD PDF' },
    ] },
    { name: 'UTILITIES', tools: [
      { label: 'Distance', alias: 'DI', title: 'Measure a distance' },
      { label: 'ID point', alias: 'ID', title: 'Coordinates of a point' },
    ] },
    { name: 'VIEW', tools: [
      { label: 'Extents', alias: 'Z', title: 'Zoom extents or window' },
      { label: '3D', alias: '3D', title: 'Show or hide the 3D preview' },
    ] },
  ];

  readonly docName = computed(() => {
    this.draft.version();
    const hall = this.draft.hall();
    const id = this.draft.store.selectedSavedId();
    const name = this.draft.store.layoutName() || (id !== null ? 'Layout' : 'Unsaved layout');
    return `${hall?.name ?? 'No hall'} · ${name}${id !== null ? ` #${id}` : ''}`;
  });
  readonly canUndo = computed(() => (this.draft.version(), this.draft.engine.canUndo));
  readonly canRedo = computed(() => (this.draft.version(), this.draft.engine.canRedo));
  readonly active = computed(() => {
    this.draft.version();
    const name = this.draft.engine.commandName;
    return this.groups.flatMap(g => g.tools).find(t => name && (t.alias === name || aliasOf(name) === t.alias))?.alias ?? null;
  });

  run(alias: string): void {
    if (alias === 'U') this.draft.engine.undo();
    else if (alias === 'REDO') this.draft.engine.redo();
    else this.draft.engine.run(alias);
    this.used.emit();
  }
}

const NAMES: Record<string, string> = {
  STALL: 'STL', STALLROW: 'SR', MOVE: 'M', COPY: 'CO', ROTATE: 'RO', ERASE: 'E', RENUMBER: 'RN',
  CHECK: 'CHK', DIST: 'DI', ID: 'ID', ZOOM: 'Z',
};

function aliasOf(name: string): string | undefined {
  return NAMES[name];
}
