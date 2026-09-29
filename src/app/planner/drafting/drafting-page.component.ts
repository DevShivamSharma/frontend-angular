import { ChangeDetectionStrategy, Component, effect, HostListener, inject, OnInit, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { AiChatSession } from '../ai-chat-session.service';
import { AiChatLauncherComponent } from '../components/ai-chat-launcher.component';
import { PdfImportDialogComponent } from '../pdf-import/pdf-import-dialog.component';
import { PlannerStore } from '../planner-store.service';
import { Scene3dComponent } from '../three/scene3d.component';
import { DraftCanvasComponent } from './draft-canvas.component';
import { DraftCommandLineComponent } from './draft-command-line.component';
import { DraftLeftPaletteComponent, DraftPropertiesComponent } from './draft-palettes.component';
import { DraftRibbonComponent } from './draft-ribbon.component';
import { DraftingService, TOGGLE_KEYS, type Toggles } from './drafting.service';

const FKEYS = Object.fromEntries(Object.entries(TOGGLE_KEYS).map(([k, v]) => [v, k as keyof Toggles]));

/**
 * The architect's drafting workspace (/draft): a 2D CAD-style drawing of the hall with the
 * command line, ribbon, layers, properties and status bar where an AutoCAD user expects them.
 * It edits the same planner state as the 3D planner: what is drawn here is what the 3D view
 * shows and what is saved.
 */
@Component({
  selector: 'app-drafting-page',
  imports: [
    DraftRibbonComponent,
    DraftLeftPaletteComponent,
    DraftPropertiesComponent,
    DraftCanvasComponent,
    DraftCommandLineComponent,
    Scene3dComponent,
    AiChatLauncherComponent,
    PdfImportDialogComponent,
  ],
  providers: [PlannerStore, AiChatSession, DraftingService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-draft-ribbon (used)="focusCanvas()" />
    <div class="body">
      <app-draft-left-palette class="left" />
      <div class="canvas-wrap">
        <app-draft-canvas />
        @if (draft.show3d()) {
          <div class="preview" aria-label="3D preview">
            <div class="preview-bar">3D preview <button type="button" (click)="draft.action('3d')" aria-label="Close 3D preview">×</button></div>
            <app-scene3d [hall]="store.currentHall()" [stalls]="store.stalls()" [showLabels]="false" [showClearances]="false" [eventType]="store.eventType()" />
          </div>
        }
        <app-ai-chat-launcher />
      </div>
      <app-draft-properties class="right" />
    </div>
    <app-draft-command-line />
    @defer (when store.pdfImport() !== null) {
      <app-pdf-import-dialog />
    }
  `,
  styles: `
    :host { position: fixed; inset: 0; display: grid; grid-template-rows: auto 1fr auto; background: #1d2330; }
    .body { display: grid; grid-template-columns: 210px 1fr 250px; min-height: 0; }
    .left { border-right: 1px solid #3a4354; }
    .right { border-left: 1px solid #3a4354; }
    .canvas-wrap { position: relative; min-width: 0; min-height: 0; }
    app-draft-canvas { position: absolute; inset: 0; }
    .preview { position: absolute; left: 12px; bottom: 12px; width: min(460px, 55%); height: min(320px, 55%); display: flex; flex-direction: column; background: #0f172a; border: 1px solid #3b82f6; border-radius: 6px; overflow: hidden; z-index: 2; }
    .preview-bar { display: flex; justify-content: space-between; align-items: center; padding: 3px 8px; font: 600 11px system-ui, sans-serif; color: #cbd5e1; background: #1e293b; }
    .preview-bar button { background: none; border: 0; color: #cbd5e1; font-size: 16px; cursor: pointer; }
    .preview app-scene3d { flex: 1; min-height: 0; position: relative; }
    @media (max-width: 900px) { .body { grid-template-columns: 1fr; } .left, .right { display: none; } }
  `,
})
export class DraftingPageComponent implements OnInit {
  readonly store = inject(PlannerStore);
  readonly draft = inject(DraftingService);
  private readonly commandLine = viewChild.required(DraftCommandLineComponent);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  private appliedHall: string | null = null;

  constructor() {
    // Opened from the editor or the setup steps with \`?hallId=\`: draw on that hall once the
    // halls are in, as the editor does.
    effect(() => {
      const hallId = this.params()?.get('hallId');
      if (!hallId || this.store.hallsStatus() !== 'ready' || this.appliedHall === hallId) return;
      this.appliedHall = hallId;
      const hall = this.store.halls().find(h => String(h.id) === hallId);
      untracked(() => {
        if (hall) this.store.setActiveHall(hall.id);
      });
    });
  }

  ngOnInit(): void {
    void this.store.loadHalls();
    void this.store.loadList();
    void this.store.loadStallTypes();
  }

  focusCanvas(): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /**
   * AutoCAD keyboard behaviour: typing goes to the command line wherever the focus is (except in
   * other text fields), Enter or Space confirm, Esc cancels, the F-keys toggle drafting aids.
   */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.store.pdfImport() !== null || document.querySelector('dialog[open]')) return;
    const cmd = this.commandLine();
    const target = e.target as HTMLElement | null;
    // Text fields keep their keys; a dropdown gives letters and Enter back to the command line.
    const inOtherField = !!target && !cmd.hasFocus() && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const ctrl = e.ctrlKey || e.metaKey;

    const fkey = FKEYS[e.key];
    if (fkey) {
      e.preventDefault();
      this.draft.toggle(fkey);
      return;
    }
    if (inOtherField) return;
    if (ctrl && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      this.draft.engine.undo();
      return;
    }
    if (ctrl && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
      e.preventDefault();
      this.draft.engine.redo();
      return;
    }
    if (ctrl && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this.draft.engine.run('SAVE');
      return;
    }
    if (ctrl && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.draft.engine.select(this.draft.engine.stalls.filter(s => s.status !== 'CANCELLED').map(s => String(s.id)));
      return;
    }
    if (ctrl || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cmd.clear();
      this.draft.engine.escape();
      return;
    }
    if (e.key === 'Enter' || (e.key === ' ' && !this.textPrompt())) {
      e.preventDefault();
      cmd.submit();
      return;
    }
    if (e.key === 'Delete' && !this.draft.engine.commandName && this.draft.engine.selection.size) {
      e.preventDefault();
      this.draft.engine.run('E');
      return;
    }
    if (!cmd.hasFocus() && e.key.length === 1) {
      e.preventDefault();
      cmd.append(e.key);
    }
  }

  /** Prompts that take free text (a prefix) keep Space as a character. */
  private textPrompt(): boolean {
    return /Prefix/.test(this.draft.engine.prompt?.text ?? '');
  }
}
