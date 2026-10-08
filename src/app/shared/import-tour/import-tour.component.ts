import {
  afterEveryRender,
  Component,
  DestroyRef,
  EventEmitter,
  inject,
  Input,
  Output,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { ImportMode, CSV_LESSONS, PDF_LESSONS } from './import-tour.data';

interface TourContext {
  mode: ImportMode | 'choose';
  stage: number;
  blockers: string[];
  canLocate: boolean;
}
interface TourAction {
  topic?: string;
  launch?: ImportMode;
}
@Component({
  selector: 'app-import-tour',
  standalone: true,
  template: `<div class="help" [class.compact]="compact">
    @if (!compact) {
      <div>
        <b>{{ stageTitle }}</b>
        <p>{{ stageHint }}</p>
        @if (blockers.length) {
          <details>
            <summary>{{ blockers.length }} pending action(s) — why can’t I continue?</summary>
            <ul>
              @for (item of blockers; track $index) {
                <li>{{ item }}</li>
              }
            </ul>
          </details>
        }
      </div>
    }
    <button type="button" (click)="open()">Start import tour</button>
  </div>`,
  styles: `
    .help {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 16px;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      margin: 16px 0;
      background: var(--mat-sys-surface-container-low);
      font-size: 13px;
    }
    p {
      margin: 6px 0;
      line-height: 1.5;
    }
    button {
      flex: none;
      border: 1px solid var(--mat-sys-primary);
      color: var(--mat-sys-primary);
      background: var(--mat-sys-surface);
      padding: 10px 14px;
      border-radius: 8px;
      cursor: pointer;
      font: inherit;
    }
    summary {
      cursor: pointer;
      margin-top: 10px;
      color: var(--mat-sys-primary);
    }
    li {
      margin: 7px 0;
    }
    .compact {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
    }
    @media (max-width: 600px) {
      .help {
        flex-direction: column;
      }
    }
  `,
})
export class ImportTourComponent {
  @Input() mode: ImportMode | 'choose' = 'pdf';
  @Input() stage = 0;
  @Input() blockers: string[] = [];
  @Input() compact = false;
  @Input() canLocate = true;
  @Input() autoOpen = false;
  @Input() autoOpenReady = true;
  @Output() locate = new EventEmitter<string>();
  @Output() launch = new EventEmitter<ImportMode>();
  private dialog = inject(MatDialog);
  private opened = false;
  private activeDialog?: MatDialogRef<ImportTourDialogComponent, TourAction>;
  constructor() {
    afterEveryRender(() => {
      if (this.autoOpen && this.autoOpenReady && !this.opened) this.open();
    });
    inject(DestroyRef).onDestroy(() => this.activeDialog?.close());
  }
  get stageTitle() {
    if (this.mode === 'csv')
      return this.stage ? 'Review the converted halls' : 'Start with your venue CSV';
    return (
      [
        'Start with your floor plan',
        'Choose actual halls',
        'Review this hall before saving',
        'Save reviewed halls',
      ][this.stage] ?? 'Import help'
    );
  }
  get stageHint() {
    if (this.mode === 'csv')
      return this.stage
        ? 'Repair any mapping errors, inspect each selected preview, then save.'
        : 'The tour explains file formats, units, mappings and separate hall saves.';
    return (
      [
        'Upload a plan. The tour walks through every control, including scans and missing detections.',
        'Green = hall. Blue = foyer / circulation. Every selected hall will save separately.',
        'Check outline → foyers → size → restrictions → imported preview. The tour shows each control.',
        'Every selected hall must be reviewed. Finish a pending hall or save the ready selection.',
      ][this.stage] ?? ''
    );
  }
  open() {
    if (this.activeDialog) return;
    this.opened = true;
    this.activeDialog = this.dialog.open(ImportTourDialogComponent, {
      width: '980px',
      maxWidth: '96vw',
      maxHeight: '94dvh',
      data: {
        mode: this.mode,
        stage: this.stage,
        blockers: this.blockers,
        canLocate: this.canLocate,
      } satisfies TourContext,
    });
    this.activeDialog.afterClosed().subscribe((action?: TourAction) => {
      this.activeDialog = undefined;
      if (action?.topic) this.locate.emit(action.topic);
      if (action?.launch) this.launch.emit(action.launch);
    });
  }
}
@Component({
  selector: 'app-import-tour-dialog',
  standalone: true,
  imports: [MatDialogModule],
  templateUrl: './import-tour-dialog.component.html',
  styleUrl: './import-tour-dialog.component.scss',
})
export class ImportTourDialogComponent {
  readonly context = inject<TourContext>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<ImportTourDialogComponent, TourAction>);
  mode = signal<ImportMode>(this.context.mode === 'csv' ? 'csv' : 'pdf');
  language = signal(0);
  index = signal(
    Math.max(
      0,
      this.lessons.findIndex((l) => l.stage === this.context.stage),
    ),
  );
  get lessons() {
    return this.mode() === 'csv' ? CSV_LESSONS : PDF_LESSONS;
  }
  get lesson() {
    return this.lessons[this.index()];
  }
  get canShow() {
    return (
      this.context.canLocate &&
      this.context.mode === this.mode() &&
      this.lesson.stage === this.context.stage
    );
  }
  changeMode(mode: ImportMode) {
    this.mode.set(mode);
    this.index.set(0);
  }
  show() {
    this.ref.close({ topic: this.lesson.id });
  }
  openImporter() {
    this.ref.close({ launch: this.mode() });
  }
}
