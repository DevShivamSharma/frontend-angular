---
name: "3D Stall Planner — planner controls"
description: "Recorded visual system for the existing hall planning workspace."
colors:
  surface-app: "#f5f6f8"
  surface-sidebar: "#f8fafc"
  surface-card: "#ffffff"
  surface-card-hover: "#f1f5f9"
  surface-selected: "#eff6ff"
  surface-track: "#eceff4"
  border-subtle: "#e4e7ec"
  border-default: "#d0d5dd"
  border-strong: "#98a2b3"
  text-primary: "#1e293b"
  text-secondary: "#475569"
  text-muted: "#5b6576"
  accent-solid: "#2563eb"
  accent-solid-hover: "#1d4ed8"
  danger-text: "#b91c1c"
  danger-surface: "#fef2f2"
  danger-border: "#fca5a5"
  warning-text: "#92400e"
  warning-surface: "#fffbeb"
  warning-border: "#fcd34d"
  success-text: "#14532d"
  success-surface: "#ecfdf3"
  success-border: "#a6f4c5"
typography:
  body:
    fontFamily: "'Inter', ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  title:
    fontFamily: "'Inter', ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.3
  label:
    fontFamily: "'Inter', ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 550
  action:
    fontFamily: "'Inter', ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  helper:
    fontFamily: "'Inter', ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif"
    fontSize: "11px"
rounded:
  sm: "5px"
  md: "7px"
  lg: "10px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-solid}"
    textColor: "{colors.surface-card}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    typography: "{typography.action}"
  button-primary-hover:
    backgroundColor: "{colors.accent-solid-hover}"
    textColor: "{colors.surface-card}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    typography: "{typography.action}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    typography: "{typography.action}"
  button-mini:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "12px"
  tab-active:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
---

# Design System: 3D Stall Planner controls

## Overview

**Creative North Star: "The existing hall planning workspace"**

This record applies to the existing 3D planner sidebar, canvas chrome, and the planning zones, guided planning, batch selection, and publication review extensions. It also records the pricing section in the Layouts tab, the price breakdown and related controls in exhibitor stall details, and the dedicated Hall pricing library at `/planner/pricing`. It also records per-zone identity controls and the narrow removal of the exhibitor map’s floating Hall card. It does not establish an identity for the venue home, setup, drafting, or the rest of the exhibitor pages. CAD retains its incumbent dark model space and local controls; the light palette and typography tokens here do not dictate the CAD palette.

The incumbent interface is a compact operating workspace: cool pale surfaces, white controls, slate text, and blue action and selection cues. Plain headings, explicit labels, restrained borders, and a large interactive hall keep the task and current state legible. This is an extracted description of the shipped code, not a newly selected visual identity.

**Key Characteristics:**

- Compact controls beside a dominant spatial canvas.
- One blue interaction accent, with separate status colors and per-zone identities.
- Visible focus, numeric alignment, and task-specific review steps.
- Scrollable stacked controls and canvas on narrow screens.

## Colors

The restrained blue and cool-neutral palette supports extended work with spatial geometry and compact forms.

### Primary

The action blue fills primary buttons and selected-state details. Its deeper sibling supplies hover feedback; the pale selected surface distinguishes active work from ordinary fields.

### Neutral

The app and sidebar surfaces separate the workspace from white cards and inputs. Slate primary, secondary, and muted text supply the reading hierarchy. Subtle borders divide rows; default borders define fields and secondary actions; stronger borders signal hover.

### Status and spatial identity

Success, warning, and danger tokens communicate outcomes and issues through tinted surfaces, borders, and text. Planning zones use distinct automatically assigned colours or a user-selected colour, paired with explicit name, type, event type and Internal/Sellable text. The shared zone-colour resolver keeps each area’s identity consistent in the list, 3D view and CAD view. Colour does not change the zone’s rules. These local spatial colours are not new action accents or fixed category tokens.

The Hall pricing library uses the same palette. Pale blue and an inset blue edge identify the selected source row. Text-bearing green Saved and amber Reference badges distinguish editable-master availability; amber notes explain source limitations and demo assumptions. These status colors do not replace the blue selection cue.

**The Role Separation Rule.** Blue identifies actions, focus, and selection; status colors communicate outcomes, while per-zone colors identify individual areas alongside textual rule semantics.

## Typography

The existing Inter-led sans stack serves headings, form controls, and support text. No display face is introduced. The frontmatter records the recurring meeting-panel hierarchy: body, title, label, action, and helper.

Section headings use a modest size step and stronger weight. Numeric fields, utilization summaries, and selection counts use tabular figures. The publication heading is a local dialog treatment (22px, reducing to 19px at 600px), not a global display scale. At 420px and below, the meeting-panel body reduces to 12px; explicit button and heading sizes remain.

The pricing extension retains its implemented compact hierarchy: 13px panel and price-breakdown text; 12px labels (weight 550), hints, file input, and import table; 14px form legends and subsection headings (weight 650); and a 16px total (weight 650). Hints use a 1.5 line height. These are local observed sizes, not a replacement for the meeting-panel roles above or a claim that the type ramp has been enlarged.

The Hall pricing library has its own observed reading hierarchy: 14px body text at 1.5 line height; 28px page heading at 1.2; 22px detail heading at 1.3; 15px subsection headings and row titles; 13px row metadata, disclosures, and notes; 12px status labels at weight 600; and 19px principal amounts at weight 650. At 480px and below, its page heading becomes 25px and principal amounts 18px. The row title uses weight 650. These sizes describe this component and do not change the shared frontmatter typography roles.

## Layout

Desktop is a fixed viewport workspace with a 380px sidebar and a flexible canvas. The sidebar header contains hall context, save action, utilization and publication state, and six section tabs. Its body scrolls independently with 12px top, 16px side, and 24px bottom padding. The interactive stage fills the remaining width; its toolbars and compact information panels float over the scene.

At 900px and below, controls and canvas stack in a vertically scrollable workspace. Outside the existing tour mode, the sidebar has no height cap; its body has a 70dvh maximum and 320px minimum height. The stage uses 50dvh, or 100dvh when the sidebar is collapsed. The optional Help tour is a separate state: its active class hides the utilization strip, publication actions, and publication override record, and gives the sidebar body 8px scroll padding at both block edges. This preserves room for the highlighted action and explanatory card, including the 320px-wide phone layout; ordinary planner surfaces retain those elements.

Meeting forms use two equal columns for paired dimensions and related selectors. Rows use 12px gaps, reduced to 8px at 420px. Actions wrap rather than forcing a single overflowing row. The publish dialog is capped at 640px width, leaves 32px of viewport allowance, and scrolls within 85dvh. Its horizontal padding reduces from 24px to 16px at 600px.

Pricing follows saved layouts in the same scrolling sidebar. Its paired fields use two equal columns with 4px row and 10px column gaps, switching to one column at 359px and below. Action rows wrap with 8px gaps. Excel preview stays in a focusable, horizontally scrollable region with a 260px maximum height; its columns do not force the sidebar wider. Native import disclosure and divided assignment sections keep the form in document flow.

The exhibitor price breakdown uses the existing stall-detail panel. At 900px and below this is a fixed, vertically scrollable bottom sheet capped at 60dvh. Its header remains sticky while details and the quote scroll, retaining the stall identity and 36px close control; the booking action retains a 44px minimum height.

The Hall pricing library is a separate document-flow workspace with a 1260px maximum width and 28px top, 32px side, and 60px bottom padding. Four labelled filters precede a master/detail grid with a 24px gap; the columns use `minmax(290px, .9fr)` and `minmax(360px, 1.3fr)`. The detail stays sticky 20px below the viewport top on desktop. At 900px and below, filters become two columns, detail moves above the list in one column, sticky positioning ends, and page padding becomes 24px 20px 44px. At 480px and below, filters become one column, page padding becomes 20px 14px 36px, and detail padding reduces from 24px to 18px. Stall results paginate in groups of 12; the hall-rental list scrolls within 75dvh on desktop and 50dvh in the stacked layout.

**The Controls and Canvas Rule.** Keep form controls in the sidebar and let the hall occupy the remaining desktop width. At the stacked breakpoint, preserve access to both controls and the hall through vertical scrolling.

## Elevation & Depth

Thin borders and pale surface changes do most of the grouping. Cards have a subtle ambient shadow; floating scene controls combine a fine ring with a broader shadow. Active sidebar tabs lift slightly from a recessed track. Publication review uses the native modal top layer with a translucent dark backdrop, so its priority comes from isolation rather than decorative elevation.

Exact shadows, focus rings, motion, and responsive breakpoints are recorded in the sidecar. Ordinary interaction transitions use the incumbent 150ms ease; button press feedback moves by 1px. The global reduced-motion rule shortens transitions and animation duration and limits animation iteration. Sidebar width changes remain immediate to avoid animating canvas layout.

The exhibitor bottom sheet retains its local upward ambient shadow; pricing adds no decorative elevation or raster imagery. The Hall pricing library detail uses a plain border and white surface; its selected row uses an inset blue edge rather than a raised card. Selection updates without an added animation, and the library ships no raster imagery.

## Shapes

Small softened corners define fields and buttons, medium corners organize compact groups, and larger corners identify cards and floating controls. Status chips remain pill shaped. The publication dialog's 14px corner and zone swatch geometry are local component details, not additions to the shared radius scale.

## Components

### Actions

Primary buttons use solid blue and white text. Secondary and mini actions use a transparent surface with a visible neutral border. Hover deepens primary blue or strengthens the secondary surface and border. Disabled actions lower opacity and use a non-interactive cursor. Meeting controls provide an explicit blue focus outline with a 3px offset. Their local button minimum height is 32px; the existing top-level save control retains its 40px minimum.

### Fields

White native inputs and selects retain persistent labels, default borders, and compact padding. Meeting fields use a 36px minimum height and tabular numerals. Focus changes the border to blue, adds the existing accent ring, and retains the local visible outline. Native invalid numeric fields use the danger border. Text areas resize vertically.

### Navigation

Six icon-and-label tabs share a pale segmented track. The active tab is a white raised surface with its icon in blue; tab counts remain compact badges. Hover and keyboard focus remain visible. Existing tab semantics and arrow-key navigation are preserved.

### Containers and status

White cards use a subtle border and small ambient shadow. Zone and publication issue lists rely on divided rows rather than a card around each item. Status chips and utilization text label the meaning of their color. Long zone names and recorded override reasons can wrap.

### Pricing controls and quote

Pricing reuses the white card, blue primary actions, bordered secondary controls, and explicit primary slate text. The conditional New/Edit form uses labelled native fields, not a separate modal or disclosure. Import alone uses a native disclosure. The component sets a 34px button minimum; fields inherit the global 38px minimum. Applied master name and revision, loading text, success notices, and empty states describe the current operation.

The shared price breakdown places charge labels on the left and non-wrapping INR amounts on the right, with tabular figures and a 12px gap. A top border, extra spacing, and stronger type distinguish Total. Rental, open-side premium, catalogue, stall tax, and any nonzero EMC charge or tax stay separately labelled. Master name, revision, and stall type remain visible above the figures. These task-specific pricing facts belong to the pricing brief.

Pricing operation failures render an alert, move focus to it after rendering, and scroll it into view without clearing form values. Recovery names the next action: return to the price form, reload masters or the saved layout, retry price, choose another workbook, or review import. Import submission failure retains the preview rows. Exhibitor quote errors retain their local Try again action; this is a separate path from the planner alert.

**The Pricing Recovery Rule.** In pricing, bring an operation failure into view and pair it with the relevant recovery action while retaining the entries needed to continue.

### Hall pricing library

The library is reached through its link in the planner pricing panel. Labelled native event, hall/location, category, and availability selectors sit above selectable divided rows. Two text-labelled buttons switch between Stall rates and Hall rentals, with a solid blue pressed state. Library controls have a 42px minimum height, 7px corners, and a visible 3px blue focus outline with a 3px offset. Rows expose pressed selection state; their hall title, event/category, amounts, date range, and Saved or Reference badge remain readable together.

The selected detail uses a white bordered container with 10px corners. Tabular amounts align on the right; section headings separate premiums and applicability dates. Native disclosures hold the editable master identity, source record, overseas fields, and secondary rental charges. On screens at or below 900px, selecting a source row focuses the detail and scrolls it into view with a 20px scroll margin. This behavior applies to both stall-rate and hall-rental selection.

Saved-master details explicitly say the values are before tax, tax and EMC are 0 for the demo, and dates/categories are selected manually. Reference details show the reasons a row needs review. Missing values remain Not specified; F&B billing bases and unspecified overseas currency remain explicit. Hall rentals are a separately labelled view, with a billing-unit caution, source category adjustments left unapplied, and a warning when the source end date precedes its start date. Loading, retryable load errors, source coverage, matching-result counts, and filtered empty states describe the current data state.

**The Pricing Source Rule.** In the Hall pricing library, show whether a source record has an editable master, keep its source limitations visible, and separate stall rates from hall rental schedules.

### Planner review patterns

The zone form offers drawing as its main action and exact coordinates in a disclosure. A labelled native colour input and Auto colour action set the area’s identity. The input is 38px high with a neutral border and 7px corners; the existing keyboard focus treatment remains visible. Edit locates the area and focuses its form. Update zone preserves the existing polygon and zone order when changing metadata. The coordinate disclosure explicitly states that Save zone coordinates makes a rectangle. The list retains a swatch beside name, kind, event type and Internal/Sellable text. Guided planning presents the seven rules before proposal controls, then supports reviewing a proposal before application. Selection controls expose shared edits and pavilion merge in the existing Stalls tab. Publication review presents utilization, issues, and location actions before its final action; an exception reason is visible when issues exist. A native dialog restores focus to the opening control when it closes.

These task sequences belong to the planner surface brief; they are not global patterns for unrelated pages.

### Canvas-specific refinements

The exhibitor map keeps its existing page header for hall/layout identity and availability; the duplicate floating dark Hall card has been removed. This change does not define a new exhibitor page identity.

CAD keeps its dark model-space world. Its local Fit plan and Pan controls expose existing navigation above the canvas, with pressed-state and focus feedback. Planning & restricted zones covers both planning and restricted geometry. Planning-zone fills and captions reuse each zone’s identity; captions select contrasting black or white text and are omitted where they do not fit. Cached geometry and live cursor/preview overlays preserve the working drawing during interaction. These CAD facts belong to the scoped planner brief, not to this document’s light control tokens.

## Do's and Don'ts

### Do:

- **Do** inherit the planner's existing CSS variables and Inter stack.
- **Do** pair a colored status or zone swatch with readable text.
- **Do** retain visible keyboard focus and labelled native fields.
- **Do** keep desktop sidebar scrolling separate from the canvas and preserve narrow-screen vertical access.
- **Do** keep rule agreement and publication exceptions explicit in their corresponding flows.

### Don't:

- **Don't** apply this planner and scoped-pricing record to unrelated routes as a redesign mandate.
- **Don't** use per-zone colors as additional primary action colors or infer planning rules from colour alone.
- **Don't** rely on a status color alone to explain an issue or a selection.
- **Don't** turn component-specific geometry into new global tokens.

Recorded from `src/styles.css`, `planner-page.component.css`, `components/meeting-controls.css`, `components/publish-dialog.component.css`, their planner templates, `pricing/pricing-panel.component.{css,html,ts}`, `pricing/price-breakdown.component.ts`, and `exhibitor-view/exhibitor-stall-details.component.{css,html,ts}`. Source CSS remains the implementation authority; this record captures its current recurring decisions. The pricing finish evidence and limited review verdict are recorded in `.impeccable/briefs/pricing.md`. The Hall pricing library additions are recorded from `pricing/pricing-library.component.{css,html,ts}` and its entry link in `pricing/pricing-panel.component.html`; its scope is `.impeccable/surfaces/c-app-planner-pricing-pricing-library-component-ts.md`.

The zone and canvas refinement is recorded from planning-zones.component.{ts,html}, meeting-controls.css, geometry/zone-colors.ts, drafting/cad-canvas.component.ts and exhibitor-view/exhibitor-view-page.component.{html,css}, under src/app/planner. Its finish evidence is in ../backend-nest/.impeccable/review/editor-improvements/finish-review.md; usage, focused validation and local fixture measurements are in ../backend-nest/docs/editor-improvements.md.

Not canonized: the CAD palette and local control geometry remain scoped to CAD, not new global light-workspace tokens. The retained exhibitor header eyebrow is an incumbent artifact, not reusable guidance. The inherited uppercase panel-title treatment is an incumbent artifact, not a new display or eyebrow rule. The detector's 12px/14px type-ramp advisories remain observations, not a reason to call those sizes an improvement or prescribe them to unrelated screens. The library's local 28/22/15/12/19/25/18px typography is recorded as built; its detector advisory does not establish a sitewide type ramp or justify changing unrelated surfaces.
