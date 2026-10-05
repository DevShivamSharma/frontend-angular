---
version: 1
slug: "c-app-planner-pricing-pricing-library-component-ts"
primary_target: "src/app/planner/pricing/pricing-library.component.ts"
related_targets: ["src/app/planner/pricing/pricing-library.component.html","src/app/planner/pricing/pricing-library.component.css"]
---

# Hall pricing library
Mode: Operate. Extend the existing pricing workflow for a client meeting. Data comes from the supplied p-db snapshot.

## Direction contract
THESIS: Find a source rate by event and hall, with its date/category intact and saved-master availability explicit.
OWN-WORLD: Inherit the planner's blue actions, white/slate controls, Inter stack and restrained borders. A light workspace suits a shared meeting screen.
STORY: Filter rates, inspect the selected schedule, distinguish editable pre-tax masters from source-only special cases.
FIRST VIEWPORT: Title and saved coverage above event/hall filters. A compact selectable rate list sits beside the selected schedule; mobile brings the schedule above the list.
FORM: Narrow pricing extension; code-led, no concept seed required. Hall rental schedules stay in a second labelled view. Selection updates details immediately without motion.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

No shipping rasters. Preserve unknown fields as unspecified. Import all source rows; do not infer missing hall mappings, currencies, billing units, taxes or EMC. Only fully specified mapped domestic stall records become editable masters. Show loading/error/retry and filtered empty states. Preserve existing layouts, bookings and user-created masters.
