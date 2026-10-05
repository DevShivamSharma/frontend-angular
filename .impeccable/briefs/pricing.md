# Pricing extension
Mode: Operate. Scope: a price-master section in the existing Layouts tab and a price breakdown in exhibitor stall details.

THESIS: Configure rates once, review them, then deliberately apply a saved revision to a layout.
OWN-WORLD: Inherit DESIGN.md and the existing planner: Inter, blue actions, white controls, slate text and compact borders.
STORY: Create or import rates; preview and save; assign to a saved layout; publish; review a server quote before booking.
FIRST VIEWPORT: Existing sidebar and hall canvas. Pricing is a labelled section under saved layouts; detailed editing and import are native disclosures.
FORM: Narrow extension of two incumbent panels. Stack labelled inputs; keep totals in an aligned definition list; use natural scroll and explicit loading, error and empty messages.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

No shipping raster assets. Approved business values are user-entered; empty rates remain unavailable. EMC is separate from SelfCare base amounts. Applying prices sets the saved layout to draft and preserves unsaved editor geometry. No payment, external posting or production deployment is claimed.

## Implemented surface — 2026-10-03

The direction contract above remains the intended scope. The shipped form opens inline after New master or Edit selected; it is conditional content, not a native disclosure. Import from Excel is the native disclosure. Pricing follows saved layouts inside the existing Layouts tab; the saved-layouts panel only adds this pricing section. No new visual world or shipping raster assets were introduced.

The panel explicitly uses the existing primary slate text token. It retains 13px body and action text, 12px labels/hints/import table text, and 14px form headings. The shared quote uses 13px rows and a 16px, weight-650 total, with tabular INR amounts aligned to the right. These are observed sizes, not a claimed type-ramp improvement. Two-column pricing fields collapse below 360px; action rows wrap; the import preview scrolls within a maximum height of 260px. The exhibitor details sheet retains its 60dvh mobile maximum and now keeps the stall header and close control sticky while quote content scrolls.

The workflow exposes master revision and layout assignment separately. Excel import previews all policy columns before saving. Applying a saved revision puts the layout in draft; the UI labels that consequence and keeps editor geometry separate. The quote labels base charges, stall tax, EMC charge, and EMC tax separately. Priced booking waits for publication and a current successful server quote, and states that booking collects no payment.

## Finish review and evidence — 2026-10-03

The initial full pricing review identified operation errors remaining offscreen after long-form actions. The final fix focuses the rendered alert and scrolls it into view, preserves entered form values, and supplies an operation-specific recovery action. A failed import submission keeps its review rows. Save failure returns to the price form; other failures offer reload, retry, workbook choice, or import review as appropriate.

Final reviewer disposition: **ship at the scored error visibility and recovery scope**. The reviewer found that finding resolved and observed no material regressions in the recaptured pricing states. This is a limited pricing finding and regression observation, not whole-app design, accessibility, or release approval.

The evidence set is in the sibling backend workspace at ../backend-nest/test-results/pricing-review/: form-top, form-bottom, applied, import, quote, quote-viewport, and error, each captured at 1440px and 390px widths. The error screenshots show the visible duplicate-name failure and recovery action; the viewport quote captures show the retained mobile close control. Screenshots evidence these rendered states, not all possible states or assistive-technology behavior.

The implementation handoff reports both real-backend browser flows passing, including duplicate-name failure triggered from the form bottom, alert focus and visibility, and preserved data. Validation also passed: frontend 341/341 tests; backend pricing 21 unit and 6 API checks; frontend and backend builds with existing warnings. The documentation pass sampled the source and relevant captured states; it did not rerun those checks.

The one detector pass advised on 12px/14px type and inherited black text. The shipped pricing section now explicitly inherits --text-primary; the existing compact type sizes remain. Neither the type advisory nor the inherited uppercase panel heading is promoted into a new design-system prescription. No further detector or whole-app audit was performed for this handoff. No payment, external posting, or production deployment is approved or claimed.
