# Planner operation surface brief

Scope: the existing planner route, especially zones, guided rule agreement, batch selection edits, and pre-publication review. Primary target: `src/app/planner/planner-page.component.ts`; related targets: its template/style, the planning-zones, guided-planning, batch-stalls, publish-dialog components, and meeting-controls.css.

Mode: Operate. Event administrators review a hall, define usable areas, agree rules, create and inspect stall proposals, edit selections, and review publication issues. The memorable interaction is locating a listed issue back on the hall.

## Direction contract

THESIS: Make rule choices and publication issues understandable within the existing planner, without replacing its established working layout.

OWN-WORLD: Blue actions, white controls, pale slate surfaces, Inter typography, compact borders, and a prominent 3D hall. The scoped CAD refinement preserves its separate dark model-space palette and command typography; the exhibitor refinement retains its light map/page and existing header.

STORY: Review zones and rules, inspect generated proposals, edit selections, then review issues and any recorded publication exception.

FIRST VIEWPORT: A fixed desktop sidebar holds hall state, actions, utilization, and six tabs beside the large canvas. Narrow screens stack scrollable controls above the canvas.

FORM: Existing sidebar-and-canvas workspace; precise code-led extension. No candidate ranking, comp, or seed key applies. Motion remains the incumbent short control feedback; issue location is the signature interaction.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation record

- Zones have labelled bounded fields, draw controls, a coordinate disclosure, and text-bearing rows. A native Zone colour picker and Auto colour choose per-zone identities, including distinct colours for same-type zones. Name, kind, B2B/B2C and Internal/Sellable remain textual semantics. The same saved colour is used in the list, 3D view and CAD view.
- Edit locates a zone and focuses its form. Update zone changes metadata while preserving its polygon and list order. Save zone coordinates explicitly rebuilds a rectangle; Redraw zone begins drawing again. Layout saving persists these changes.
- CAD exposes Fit plan and Pan, and names its shared visibility layer Planning & restricted zones. An offscreen drawing cache holds geometry while cursor, preview and command feedback are painted live; geometry, interaction state and viewport changes refresh the cache. Its dark palette remains local to CAD.
- The exhibitor map’s floating dark Hall card is removed; its hall/layout header and availability counts remain.
- Guided planning displays seven rules before the generation controls. Proposal review remains explicit before Apply.
- Multi-selection actions and pavilion merge belong in Stalls; store validation governs whether a complete change succeeds.
- Publication review exposes utilization, issue rows, Locate actions, and an exception reason when required. Native modal close restores focus.
- Desktop keeps the fixed sidebar and canvas. Mobile uses the implemented stacked, scrollable layout. During the optional Help tour only, utilization, publication actions, and the publication override record are hidden; the sidebar body receives 8px scroll padding at both block edges so highlighted actions remain visible. Ordinary planner surfaces are unchanged.
- No raster assets were created or changed for this extension.

## Finish evidence and limits

The fresh reviewer inspected desktop and mobile Zones, Rules, and Publish captures in `.impeccable/review`. The reported disposition is ship after the sole PRODUCT.md factual-scope fix was resolved. DESIGN.md and the extensions-only sidecar record the implemented visual decisions. The documenter sampled `zones-1440.png` and `publish-390.png` against the source.

After the final tour visibility correction, the full five-step tour regressions passed at 1440x900, 390x844, and 320x568. Fresh stall and position captures are retained under `test-results/meeting-tour-confirm/artifacts`. The documenter checked the smallPhone stall capture against the final tour CSS. The correction reviewer inspected all six fresh desktop, mobile, and small-phone stall/position captures and returned ship at this narrow scope: the 320x568 highlighted action is fully visible and the correction shows no visible regression. The final frontend production build passed. This correction review does not expand the earlier surface-review scope. No shipping raster was introduced.

The scope is the planner extension. This brief makes no design or review claim about unrelated pages. Existing tiny uppercase statistic/card labels and the unresolved `--accent-text` reference in the drawing-status rule were deliberately not promoted into reusable guidance. No implementation change is made by this documentation pass.

The bundled Impeccable Windows CLI was unavailable; this development-only brief was persisted directly.

## Editor refinement follow-up — 3 October 2026

The scope is the existing zone form/list, matching 3D and CAD zone identity, CAD navigation and drawing performance, and removal of the exhibitor map’s duplicate Hall card. This is a refinement with no comp round, seed key, new visual world or raster assets.

The fresh finish reviewer used the degraded finish-reviewer role and returned ship with no material fixes. All eight desktop/mobile captures in ../backend-nest/.impeccable/review/editor-improvements were opened and validated, including the scrolled zone views. The existing detector reported 32 advisories and no primary findings; it was not rerun. The documenter used the degraded documenter role, sampled zones-edit-desktop.png and cad-mobile.png against source, and merged the existing DESIGN.md and sidecar. No specialized documenter role was available.

Browser checks drew two same-kind zones with different auto colours, changed the first to green, saved/reloaded #047857 and #c2410c, confirmed matching CAD colours, exercised Pan/Fit plan, and generated/applied/saved 64 AI stalls. The owned temporary layout 1108 was removed afterward. These interaction results and the focused tests were reported by the implementing agent; the documenter did not rerun them. Verification comprised 79 backend unit tests, 84 focused frontend tests (29 colour/component/CAD and engine checks plus 55 store/workflow guards), four test-database API checks, backend type-check and the Angular development build. The API runner exited 0 after its Windows teardown hang was cleared by stopping only the verified test server. This is not a full-suite verification claim.

The static mobile captures do not establish touch-drag behavior. Performance results are local fixtures, not a product guarantee; the fine-grid AI case takes longer while placing substantially more stalls. Usage and retained measurements: ../backend-nest/docs/editor-improvements.md. External SelfCare, EMC permissions/approval, payment and hold/cancellation workflows, production deployment and broader CAD work remain; Phase 2 is still in progress.
