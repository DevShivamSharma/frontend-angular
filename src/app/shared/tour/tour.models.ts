/**
 * A guided tour that plays itself: one thing lit up at a time. An info step shows long enough
 * to read, then the next follows; an action step does its action itself (`play`), so the person
 * sees it done. Only the last step waits, for Finish; the tour can be skipped at any time.
 */
export interface TourStep<C> {
  id: string;
  title: string;
  /** 1 to 3 short paragraphs. */
  body: string[];
  /** Shown as a key chip beside the title, e.g. `B` or `Ctrl + D`. */
  shortcut?: string;
  /** CSS selector of what to light up, e.g. `[data-tour="booth-tool"]`; none: centred. */
  target?: string;
  /** Gets the page ready: opens a panel, switches the view. Runs on Back too. */
  before?: (ctx: C) => void | Promise<void>;
  action?: TourAction<C>;
}

export interface TourAction<C> {
  /** What the tour does now, in words. */
  prompt: string;
  /** Does it, as the person would. */
  play: (ctx: C) => void | Promise<unknown>;
  /** Whether it is done. Read from signals, so the tour notices the moment it happens. */
  done: (ctx: C) => boolean;
}

export type TourEnd = 'finish' | 'skip' | 'close';

export interface TourOptions {
  /** Called once when the tour ends, however it ends. */
  onEnd?: (reason: TourEnd) => void;
  /** What the tour made, in words ("1 booth, 1 zone"); null when nothing. */
  made?: () => string | null;
  /** Removes what the tour made. */
  removeMade?: () => void;
}
