import { computed, signal } from '@angular/core';
export type StageId = 'venue' | 'rooms' | 'halls';
export type StageState = 'loading' | 'ready' | 'error';
interface Stage { state: StageState; progress: number; }
const weights: Record<StageId, number> = { venue: 80, rooms: 10, halls: 10 };
export class VenueLoadingState {
  readonly stages = signal<Record<StageId, Stage>>({ venue: { state: 'loading', progress: 0 }, rooms: { state: 'loading', progress: 0 }, halls: { state: 'loading', progress: 0 } });
  readonly percent = computed(() => Math.floor((Object.keys(weights) as StageId[]).reduce((sum, id) => sum + weights[id] * this.stages()[id].progress, 0)));
  readonly ready = computed(() => Object.values(this.stages()).every(stage => stage.state === 'ready'));
  readonly failed = computed(() => Object.values(this.stages()).some(stage => stage.state === 'error'));
  readonly status = computed(() => this.failed() ? 'We couldn’t finish loading your experience. Please try again.' : this.ready() ? 'Your experience is ready.' : this.stages().venue.state === 'ready' ? 'Preparing your halls and meeting rooms…' : 'Loading Bharat Mandapam…');
  private readonly pending = new Map<StageId, Promise<void>>();
  private readonly tasks = new Map<StageId, () => Promise<unknown>>();
  private destroyed = false;
  run(id: StageId, task: () => Promise<unknown>): Promise<void> {
    if (this.pending.has(id)) return this.pending.get(id)!;
    if (this.stages()[id].state === 'ready' || this.destroyed) return Promise.resolve();
    this.tasks.set(id, task);
    this.set(id, { state: 'loading', progress: 0 });
    const pending = Promise.resolve().then(task).then(() => this.set(id, { state: 'ready', progress: 1 }), () => this.set(id, { state: 'error', progress: 0 })).finally(() => this.pending.delete(id));
    this.pending.set(id, pending);
    return pending;
  }
  progress(id: StageId, value: number): void {
    const entry = this.stages()[id];
    if (entry.state === 'loading' && Number.isFinite(value)) this.set(id, { ...entry, progress: Math.max(entry.progress, Math.min(.98, Math.max(0, value))) });
  }
  retry(): Promise<void[]> { return Promise.all((Object.keys(weights) as StageId[]).filter(id => this.stages()[id].state === 'error').map(id => this.run(id, this.tasks.get(id)!))); }
  destroy(): void { this.destroyed = true; }
  private set(id: StageId, entry: Stage): void { if (!this.destroyed) this.stages.update(stages => ({ ...stages, [id]: entry })); }
}
