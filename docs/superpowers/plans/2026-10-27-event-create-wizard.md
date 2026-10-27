# Event Create Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "Create event" page with a step-by-step modal wizard, matching the pixel-perfect reference screenshot for its "Format and organiser" step and reusing the app's own existing fields/validators for every other step.

**Architecture:** A new `EventWizardDialogComponent` (the established inline `<p-dialog [(visible)]="visible">` pattern already used by `AddHallsDialogComponent`/`CategoryDialogComponent`, not the `AppDialog` dynamic-dialog service) wraps the *existing* `createEventForm(fb, 'create')` reactive form from `domain/event.form.ts` and renders its controls across 9 step panels instead of the current accordion. `EventCreatePageComponent` opens it in place of `<app-event-form mode="create">`; submission reuses the exact same create-API-call/confirm/error-handling logic that lives there today. `EventFormComponent` (accordion) is left untouched and keeps serving `event-edit-page` — edit mode is out of scope.

**Tech Stack:** Angular 20 (standalone components, signals), PrimeNG 20 (`p-dialog`, `p-select`, `p-datepicker`, `p-inputnumber`, `p-selectbutton`, `p-toggleswitch`), existing `AppFormField`/`app-form-field` wrapper, existing CSS tokens in `src/styles/_tokens.scss`.

**Spec:** The one verified visual reference is the user-supplied screenshot of the "Format and organiser" step (title "Format and organiser", subtitle, 4 fields in a 2-column grid each with a label + input + one-line hint, a left-hand step nav with done/current/upcoming states, a header with the event name + "Draft"/"Internal event" badges, and a footer with "Discard draft" (left) and Back/Next (right)). No spec exists for the other 8 steps' exact layout — by explicit user decision, those steps reuse the fields and copy that already exist in `event-form.component.html`/`event.form.ts`, laid out the same way (one `app-form-field` per row inside a `form-grid`), not an invented new design.

## Global Constraints

- Do not add `Validators.required` to any control that isn't already required in `domain/event.form.ts` — the screenshot's "All fields are required" subtitle does not apply to our real, mostly-optional fields; step subtitles must describe the step honestly instead of copying that line.
- Do not implement a fake "saved as you type, HH:mm" autosave indicator — there is no backend draft concept (`CreateEventPayload` has no draft status), so a timestamp that doesn't actually persist anything would be misleading. Show the "Draft" / "Internal event" badges only (both true: nothing is created yet, and this is always an internal event).
- Halls cannot be attached before the event exists (the hall APIs need a real `eventId`), so the "Halls" and "Booking setup" steps are informational placeholders that explain this and never block `Next`/`Create event` — they do not duplicate `AddHallsDialogComponent`.
- `EventFormComponent`, `event-edit-page`, and every exported name in `domain/event.form.ts` (`createEventForm`, `toCreatePayload`, `toUpdatePayload`, `patchKnownFields`, `EventForm` type) are reused as-is, unmodified in behavior.
- `EventCreatePageComponent.hasUnsavedChanges()` must keep returning `true` whenever the wizard's form is dirty, so the existing `unsavedChangesGuard` on the `events/new` route keeps working without changes to `app.routes.ts`.
- Follow the codebase's existing dialog footer/header template convention (`<ng-template #header>`, `<ng-template #footer>`) and its CSS token names (`--app-brand`, `--app-success`, `--app-muted`, `--app-border`, `--space-*`, `--text-*`) — no new color literals, no new design-token file.

## Review Focus

- Clicking "Next" on the "Event" step while `organisationId`/`name`/`startDate`/`endDate` are still empty must not silently advance — it must mark those four controls touched and keep the user on the step so `app-form-field`'s existing error text shows.
- A server-side validation error on submit (e.g. a duplicate file number) must land back on the right step and field, the same way `EventFormComponent.applyError()` does today via `applyServerErrors`, not just show a generic toast with no way to see which field failed.
- Reopening the wizard after a cancelled/discarded draft (navigate away and back to `/events/new`) must start from a clean form, not the previous attempt's half-filled values.
- The `unsavedChangesGuard` must still fire when the wizard's form is dirty and the user navigates away (e.g., clicks the browser back button or another nav link while the dialog is open) — `hasUnsavedChanges()` must read the wizard's live form state, not a stale snapshot from when the dialog opened.
- `productCategory`'s options (`categoryGroups`) must load exactly once and fail soft (empty list) exactly like `EventFormComponent` does today, not throw an unhandled error that blocks the whole wizard from opening.

---

## Task 1: Wizard step model and status logic

**Files:**
- Create: `src/app/features/events/domain/event-wizard-steps.ts`
- Test: `src/app/features/events/domain/event-wizard-steps.spec.ts`

**Interfaces:**
- Produces:
  - `type WizardStepId = 'event' | 'description' | 'organiser' | 'schedule' | 'numbers' | 'settings' | 'halls' | 'booking' | 'review'`
  - `interface WizardStep { id: WizardStepId; label: string; note?: string; requiredControls?: readonly string[] }`
  - `const WIZARD_STEPS: readonly WizardStep[]` — the 9 steps below, in order:
    1. `{ id: 'event', label: 'Event', requiredControls: ['organisationId', 'name', 'startDate', 'endDate'] }`
    2. `{ id: 'description', label: 'Description and notes' }`
    3. `{ id: 'organiser', label: 'Format and organiser' }`
    4. `{ id: 'schedule', label: 'Exhibition days and timings' }`
    5. `{ id: 'numbers', label: 'Expected numbers' }`
    6. `{ id: 'settings', label: 'Settings' }`
    7. `{ id: 'halls', label: 'Halls', note: 'Added after the event is created' }`
    8. `{ id: 'booking', label: 'Booking setup', note: 'Optional now' }`
    9. `{ id: 'review', label: 'Review' }`
  - `type WizardStepStatus = 'done' | 'current' | 'upcoming'`
  - `function wizardStepStatus(step: WizardStep, index: number, currentIndex: number, isValid: (controls: readonly string[]) => boolean): WizardStepStatus`
  - `function wizardCompletedCount(steps: readonly WizardStep[], currentIndex: number, isValid: (controls: readonly string[]) => boolean): { done: number; total: number }` — counts only steps at index 0–5 (the six pre-creation steps) whose own `requiredControls` (or, when absent, an empty array, which `isValid` must treat as always valid) pass `isValid`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('wizardStepStatus', () => {
  it('returns current for the step at currentIndex regardless of validity', () => {
    const step = WIZARD_STEPS[0];
    expect(wizardStepStatus(step, 0, 0, () => false)).toBe('current');
  });

  it('returns upcoming for a step after currentIndex', () => {
    const step = WIZARD_STEPS[2];
    expect(wizardStepStatus(step, 2, 0, () => true)).toBe('upcoming');
  });

  it('returns upcoming for a passed step whose required controls are still invalid', () => {
    const step = WIZARD_STEPS[0]; // 'event', has requiredControls
    expect(wizardStepStatus(step, 0, 1, () => false)).toBe('upcoming');
  });

  it('returns done for a passed step with no required controls', () => {
    const step = WIZARD_STEPS[1]; // 'description', no requiredControls
    expect(wizardStepStatus(step, 1, 2, () => false)).toBe('done');
  });

  it('returns done for a passed step whose required controls are valid', () => {
    const step = WIZARD_STEPS[0];
    expect(wizardStepStatus(step, 0, 1, () => true)).toBe('done');
  });
});

describe('wizardCompletedCount', () => {
  it('counts all six pre-creation steps as done once the event step is valid', () => {
    expect(wizardCompletedCount(WIZARD_STEPS, 5, () => true)).toEqual({ done: 6, total: 6 });
  });

  it('excludes the event step while it is still invalid, even after it has been passed', () => {
    const isValid = (controls: readonly string[]) => controls.length === 0;
    expect(wizardCompletedCount(WIZARD_STEPS, 5, isValid)).toEqual({ done: 5, total: 6 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --watch=false --include=**/event-wizard-steps.spec.ts`
Expected: FAIL — `event-wizard-steps` module not found.

- [ ] **Step 3: Implement `event-wizard-steps.ts`**

`wizardStepStatus`: if `index === currentIndex` return `'current'`; if `index > currentIndex` return `'upcoming'`; if `step.requiredControls` is non-empty and `!isValid(step.requiredControls)` return `'upcoming'`; otherwise `'done'`.
`wizardCompletedCount`: `total` is always `6`; `done` is the count, over `WIZARD_STEPS.slice(0, 6)`, of steps where `isValid(step.requiredControls ?? [])` is true.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --watch=false --include=**/event-wizard-steps.spec.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/events/domain/event-wizard-steps.ts src/app/features/events/domain/event-wizard-steps.spec.ts
git commit -m "feat(events): add wizard step model and status logic"
```

---

## Task 2: `EventWizardDialogComponent` shell — dialog, header, nav, and the "Event" step

**Files:**
- Create: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.ts`
- Create: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.html`
- Create: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.scss`

**Interfaces:**
- Consumes: `createEventForm(fb, 'create')`, `toCreatePayload(form)`, `EventForm` from `../../domain/event.form`; `WIZARD_STEPS`, `wizardStepStatus`, `wizardCompletedCount` from `../../domain/event-wizard-steps`; `applyServerErrors` from `../../../../shared/utils/form.util`; `ApiError` from `../../../../core/http/api-error`; `Organisation`, `CreateEventPayload` from `../../data/events.models`; `FormFieldComponent` from `../../../../shared/forms/form-field/form-field.component`.
- Produces (what `EventCreatePageComponent` will call in Task 5):
  - `class EventWizardDialogComponent`
  - `readonly visible: ModelSignal<boolean>` (via `model(false)`)
  - `readonly organisations: InputSignal<Organisation[]>` (default `[]`)
  - `readonly organisationsLoading: InputSignal<boolean>` (default `false`)
  - `readonly submitting: InputSignal<boolean>` (default `false`)
  - `readonly failure: InputSignal<string | null>` (default `null`)
  - `readonly created: OutputEmitterRef<CreateEventPayload>`
  - `readonly cancelled: OutputEmitterRef<void>`
  - `open(): void` — resets the form to empty, sets `stepIndex` to `0`, sets `visible` to `true`.
  - `hasUnsavedChanges(): boolean` — `this.form.dirty`.
  - `applyError(error: ApiError): boolean` — `applyServerErrors(this.form, error)`.

- [ ] **Step 1: Write the component class**

```ts
@Component({
  selector: 'app-event-wizard-dialog',
  imports: [ReactiveFormsModule, DialogModule, ButtonModule, SelectModule, DatePickerModule, FormFieldComponent /* + the rest Task 3 needs */],
  templateUrl: './event-wizard-dialog.component.html',
  styleUrl: './event-wizard-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventWizardDialogComponent {
  readonly visible = model(false);
  readonly organisations = input<Organisation[]>([]);
  readonly organisationsLoading = input(false);
  readonly submitting = input(false);
  readonly failure = input<string | null>(null);
  readonly created = output<CreateEventPayload>();
  readonly cancelled = output<void>();

  private readonly fb = inject(FormBuilder);
  protected readonly form = createEventForm(this.fb, 'create');
  protected readonly steps = WIZARD_STEPS;
  protected readonly stepIndex = signal(0);

  protected readonly isValid = (controls: readonly string[]): boolean =>
    controls.every((name) => this.form.get(name)?.valid ?? true);
  protected readonly completed = computed(() => wizardCompletedCount(this.steps, this.stepIndex(), this.isValid));
  protected status(index: number) { return wizardStepStatus(this.steps[index], index, this.stepIndex(), this.isValid); }
  protected readonly eventStepValid = computed(() => this.isValid(this.steps[0].requiredControls ?? []));

  open(): void { /* form.reset(), stepIndex.set(0), visible.set(true) */ }
  hasUnsavedChanges(): boolean { return this.form.dirty; }
  applyError(error: ApiError): boolean { return applyServerErrors(this.form, error); }

  protected goTo(index: number): void { /* no-op if index > 0 && !this.eventStepValid() */ }
  protected back(): void { /* stepIndex.update(i => Math.max(0, i - 1)) */ }
  protected next(): void { /* if stepIndex()===0 and invalid: markAllTouched on the 4 controls, return. else advance. */ }
  protected discard(): void { this.visible.set(false); this.cancelled.emit(); }
  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) { this.goTo(0); return; }
    this.created.emit(toCreatePayload(this.form));
  }
}
```

The implementer fills in `open()`/`goTo()`/`back()`/`next()` bodies per the one-line comments above — each is a direct, single-purpose signal update, no further design choice involved.

- [ ] **Step 2: Write the template's dialog shell, `#header` template, and nav list**

`p-dialog` with `[(visible)]="visible"`, `[modal]="true"`, `[dismissableMask]="false"`, `[closable]="!submitting()"`, `[draggable]="false"`, `[style]="{width:'72rem', maxWidth:'96vw', height:'85vh'}"`, `[contentStyle]="{padding:'0'}"`.

`<ng-template #header>`: event name (from `form.controls.name.value`, falling back to "New internal event" while empty) as the title, then a row of badges — "Draft" and "Internal event" (reuse the `.badge`/`.tag`-style classes already in the design system; if none fit as plain static badges, a `<span class="badge">` using the existing `_data-table.scss` `.badge` class is acceptable since it is already global).

Below the header, inside the dialog body: a two-column layout (`<nav class="wizard-nav">` + `<div class="wizard-step">`) — the nav renders `@for (step of steps; track step.id; let i = $index)` as a `<button type="button" [attr.aria-current]="i === stepIndex() ? 'step' : null" [disabled]="i > 0 && !eventStepValid()" (click)="goTo(i)">`, each showing: a status icon (`pi-check` in `--app-success` for `'done'`, a filled `--app-brand` dot/number for `'current'`, a plain numbered circle in `--app-muted`/`--app-border` for `'upcoming'`), the step's `label`, and its `note` when present, in a `<small>`.

Below the nav list: the `completed()` counter as `"{{ completed().done }} of {{ completed().total }} required sections complete"`.

- [ ] **Step 3: Write the "Event" step panel (`@if (stepIndex() === 0)`)**

Port the existing "Event" section fields verbatim from `event-form.component.html` lines 2–100 (organisation select shown only when needed — here always, since this dialog is create-only; event name; start/end date pickers; the `eventDates` cross-field error; event type select), bound to `form.controls.*` instead of `active.controls.*`. Same `app-form-field` usage, same `[options]`, same hints.

- [ ] **Step 4: Write the dialog's `#footer` template**

Three-part flex row (`justify-content: space-between`, styled in Step 5's SCSS): "Discard draft" (`p-button`, `[text]="true"`, `severity="secondary"`, `(onClick)="discard()"`, `[disabled]="submitting()"`) on the left; "Back" (`[disabled]="stepIndex() === 0 || submitting()"`, `(onClick)="back()"`) and "Next" (label interpolated as `'Next: ' + steps[stepIndex() + 1].label`, hidden when `stepIndex() === steps.length - 1`, `(onClick)="next()"`) on the right. The terminal "Create event" button (Task 4) replaces "Next" only on the last step.

- [ ] **Step 5: Write the SCSS**

Two-column grid (`grid-template-columns: 14rem 1fr` or similar, matching the screenshot's proportions), nav item states using `--app-brand` (current), `--app-success` (done), `--app-muted`/`--app-border` (upcoming), footer as `display:flex; justify-content:space-between; align-items:center; width:100%` scoped under `:host ::ng-deep .p-dialog-footer` (component-scoped only — do not touch the global dialog stylesheet).

- [ ] **Step 6: Manual verification**

Run: `npm start` (or the already-configured `stall-designer-frontend` preview), navigate to `/events/new` once wired in Task 5, confirm the dialog opens, the "Event" step renders and its required-field validation blocks `Next`/other nav items until filled.
Expected: dialog visually matches the screenshot's chrome (header, nav, footer); no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/features/events/components/event-wizard-dialog/
git commit -m "feat(events): add event-wizard-dialog shell with the Event step"
```

---

## Task 3: Steps 2–6 — Description, Format and organiser, Exhibition days, Expected numbers, Settings

**Files:**
- Modify: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.ts`
- Modify: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.html`
- Modify: `src/app/features/events/components/event-form/event-form.component.html:166-198` (hint text and label spelling only — see Step 1 below)

**Interfaces:**
- Consumes: `CategoriesApiService.groups()`, `categoryGroups` mapper from `../../../categories/domain/category-groups` (same imports `EventFormComponent` already uses), `EVENT_KINDS` from `../../data/events.models` (not needed here — kinds select lives in the Event step, already done in Task 2).
- Produces: no new public members; `protected readonly categoryGroups = toSignal(...)` (same shape as `EventFormComponent.categoryGroups`), used by the "Format and organiser" panel's product-category `p-select`.

- [ ] **Step 1: Fix the "Format and organiser" copy in `event-form.component.html` to match the screenshot**

Change `label="Co-organizer"` → `label="Co-organiser"` (and its `inputId`/`formControlName` stay `coOrganizerName` — only the visible label text changes). Add `hint="How the event runs, e.g. Exhibition, or Exhibition and conference."` to the `eventFormat` field, `hint="A partner organisation. Write "None" if there is none."` to the `coOrganizerName` field, and `hint="The file reference for this event, e.g. ITPO/F&E/2027/014."` to the `fileNumber` field (the `productCategory` field already has its hint). This is the one piece of this plan that also touches the existing accordion (edit) form, because it is pure, accurate, low-risk copy that the screenshot pins.

- [ ] **Step 2: Add the `categoryGroups` signal to the wizard component**

Same construction as `EventFormComponent.categoryGroups` (Task 2's class, `protected readonly categoryGroups = toSignal(inject(CategoriesApiService).groups().pipe(map(onlyCategoryGroups), catchError(() => of([]))), { initialValue: [] })`).

- [ ] **Step 3: Write the "Description and notes" panel (`@if (stepIndex() === 1)`)**

Port `event-form.component.html` lines 108–151 verbatim (description, product profile, specific product profile, special request, remarks), bound to `form.controls.*`. Add a one-line step subtitle: "Background on the event, for ITPO's own records."

- [ ] **Step 4: Write the "Format and organiser" panel (`@if (stepIndex() === 2)`), pixel-matched to the screenshot**

Port `event-form.component.html` lines 158–198 (now carrying Step 1's corrected label/hints) verbatim, bound to `form.controls.*`, laid out as the screenshot's 2×2 grid (reuse the existing `form-grid` class, which already does a 2-column layout — see `event-form.component.scss`). Step subtitle: "How the event runs, who co-organises it, and its file reference." (note: **not** "All fields are required" — see Global Constraints).

- [ ] **Step 5: Write the "Exhibition days and timings" panel (`@if (stepIndex() === 3)`)**

Port lines 207–256 verbatim (exhibition start/end dates, the `exhibitionDates` cross-field error, opens-at/closes-at times).

- [ ] **Step 6: Write the "Expected numbers" panel (`@if (stepIndex() === 4)`)**

Port lines 265–312 verbatim (expected visitors/exhibitors, number of stalls, number of F&B stalls, max categories for registration).

- [ ] **Step 7: Write the "Settings" panel (`@if (stepIndex() === 5)`)**

Port lines 320–333 verbatim (overseas users, marquee, secondary toggles), plus the existing "Public list" visibility `p-selectbutton` from lines 339–355 (bind `formControlName="visibility"`, `[options]="visibilityOptions"` — add `protected readonly visibilityOptions = [{ label: 'Hidden', value: 'hide' }, { label: 'Show in the public list', value: 'show' }]` to the class, matching `EventFormComponent`'s create-mode options exactly).

- [ ] **Step 8: Manual verification**

Run: `npm start`, step through 1→6 via "Next", confirm every field round-trips into the form (type a value, go back, confirm it is still there — `FormGroup` state is shared across panels since they all bind the same `form`, so this should hold with no extra wiring) and that the "Format and organiser" panel's spacing/hints match the screenshot.
Expected: no data loss between steps; "Format and organiser" visually matches the reference screenshot.

- [ ] **Step 9: Commit**

```bash
git add src/app/features/events/components/event-wizard-dialog/ src/app/features/events/components/event-form/event-form.component.html
git commit -m "feat(events): add steps 2-6 to the event wizard, pixel-match Format and organiser"
```

---

## Task 4: Steps 7–9 — Halls, Booking setup, Review, and wiring submit

**Files:**
- Modify: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.ts`
- Modify: `src/app/features/events/components/event-wizard-dialog/event-wizard-dialog.component.html`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (this task only adds template panels and finishes `submit()`/`next()`/`goTo()` bodies already declared in Task 2).

- [ ] **Step 1: Write the "Halls" panel (`@if (stepIndex() === 6)`)**

A short `app-empty-state`-style message (reuse `EmptyStateComponent`, `icon="pi-building"`, `title="Halls are added after the event is created"`, `message="Once you create the event, open it to add the halls it uses."`) — no form controls, this step never blocks `Next`.

- [ ] **Step 2: Write the "Booking setup" panel (`@if (stepIndex() === 7)`)**

Same `EmptyStateComponent` pattern, `title="Booking setup is optional for now"`, `message="You can configure this after the event is created."`.

- [ ] **Step 3: Write the "Review" panel (`@if (stepIndex() === 8)`)**

A read-only summary list (`<dl>` of label/value pairs, or reuse `.item-card__meta`-style rows) showing: event name, organisation (look up by id from `organisations()`), dates, event type, event format, co-organiser, product category, file number, exhibition dates/times, expected numbers, the three toggle settings, and visibility — all read from `form.getRawValue()`. Below the summary, surface `failure()` the same way `event-form.component.html`'s `actionbar__message` does today (`<i class="pi pi-exclamation-circle"></i> {{ failure() }}`).

- [ ] **Step 4: Finish `next()`, `goTo()`, and the footer's terminal button**

`next()`: if `stepIndex() === 0` and `!eventStepValid()`, call `['organisationId','name','startDate','endDate'].forEach(c => form.get(c)?.markAsTouched())` and return; otherwise `stepIndex.update(i => Math.min(steps.length - 1, i + 1))`.
`goTo(index)`: if `index > 0 && !eventStepValid()` return (no-op); otherwise `stepIndex.set(index)`.
In the footer template: when `stepIndex() === steps.length - 1` (Review), render `p-button [label]="'Create event'" icon="pi pi-check" [loading]="submitting()" [disabled]="submitting()" (onClick)="submit()"` instead of the "Next" button.

- [ ] **Step 5: Manual verification**

Run: `npm start`, step all the way to Review, confirm the summary reflects what was typed, confirm `failure()` (simulate by rejecting the API, or by reading the code path) renders on the Review step.
Expected: Review step shows accurate data; no console errors; `Create event` button is present only on the last step.

- [ ] **Step 6: Commit**

```bash
git add src/app/features/events/components/event-wizard-dialog/
git commit -m "feat(events): add Halls, Booking setup and Review steps to the event wizard"
```

---

## Task 5: Wire the wizard into `event-create-page`

**Files:**
- Modify: `src/app/features/events/pages/event-create-page/event-create-page.component.ts`
- Modify: `src/app/features/events/pages/event-create-page/event-create-page.component.html`

**Interfaces:**
- Consumes: `EventWizardDialogComponent` (Task 2–4's `open()`, `hasUnsavedChanges()`, `applyError()`, `visible` model, `created`/`cancelled` outputs — identical method names to what `EventFormComponent` already offered, so `create()`/`cancel()`/`hasUnsavedChanges()` in this file need no logic changes, only the `viewChild` type and the template tag).
- Produces: nothing new.

- [ ] **Step 1: Swap the template**

Replace `event-create-page.component.html`'s `<app-event-form mode="create" ...>` with `<app-event-wizard-dialog #wizard [organisations]="organisations()" [organisationsLoading]="organisationsLoading()" [submitting]="submitting()" [failure]="failure()" (created)="create($event)" (cancelled)="cancel()" />`.

- [ ] **Step 2: Swap the component wiring**

In `event-create-page.component.ts`: change the import and `imports: [...]` entry from `EventFormComponent` to `EventWizardDialogComponent`; change `private readonly form = viewChild.required(EventFormComponent)` to `private readonly wizard = viewChild.required(EventWizardDialogComponent)`; update the two call sites (`this.form().hasUnsavedChanges()` → `this.wizard().hasUnsavedChanges()`, `this.form().applyError(error)` → `this.wizard().applyError(error)`). Add an `ngAfterViewInit` (or a `constructor`-time `afterNextRender`/effect, whichever the Angular version here idiomatically supports — check how other pages in this app open a dialog on load, e.g. none currently do; the simplest correct option is `ngAfterViewInit(): void { this.wizard().open(); }`, implementing `AfterViewInit`) so the dialog opens as soon as the page loads.

- [ ] **Step 3: Verify the route end-to-end**

Run: `npm start`, navigate to `/events/new`, confirm the wizard opens automatically, complete it, confirm it calls the create API and navigates to `/events/:id` exactly as before (same confirm dialog, same success toast, same error-on-field behavior for a rejected submission).
Expected: behavior identical to today's create flow, new UI.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/events/pages/event-create-page/
git commit -m "feat(events): open the event wizard dialog from the create-event route"
```
