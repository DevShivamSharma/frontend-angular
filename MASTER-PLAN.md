# MASTER PLAN — AI-assisted Hall Layout & Stall Planning (ITPO / Bharat Mandapam)

> Updated: 3 October 2026, after the review meeting (transcript) and a code audit.
> Goal: **Thursday CEO demo** → ITPO admin portal (Phase 1) → EMCs (Phase 2).
> Sir's direction for now: *"isko publish tak simple socho"* — everything up to **Publish**; pricing later.

---

## 1. Approach decided (problem statement + meeting)

Aaj architect baith ke manually stalls kaatta hai. Usko replace karna hai ek **rule-driven, AI-assisted** flow se, jo ITPO ke portal par chalega.

```
Step 1  Bare hall layout      PDF/CAD se import: entries, exits, fire exits, pillars, passages
Step 2  Zones                 Hall par kheench ke zones: Media, Admin (internal, bikte nahi), Food, Exhibition (bikte hain)
Step 3  Stall cutting         Sellable zones ke andar rule engine se stalls; pehle sabse bada area, phir corners
Step 4  Manual touch-up       Khaali jagah dikhe to user khud stall add kare; multi-select se side-opening
Step 5  Publish               Pre-publish check (issues, 70%, suggestions) → auto numbering → published
```

## 2. Meeting decisions (priority order)

| # | Decision (meeting) | What it means in the product |
|---|---|---|
| D1 | 3-step flow: bare layout → zones → stalls | Zones step add karna (drag/stretch on the hall) |
| D2 | Media/Admin = internal, Food/Exhibition = bikta hai | Zone type + sellable; internal zone mein stall nahi |
| D3 | **Rules pehle** — "ye 7 standard rules hain, agree karo ya change karo", phir size/count poochho | AI chat mein guided flow: Rules card → Agree/Modify → size step |
| D4 | Min aisle **1.5 m**, upar badha sakte (3 m), neeche nahi | Passage range 3–5 m → **1.5–5 m** |
| D5 | Emergency exit ke aage **3 m** | Emergency access depth kam se kam 3 m, chahe aisle 1.5 ho |
| D6 | Hall ke corners par stall nahi | Corner keep-out rule (code mein tha, chalta nahi tha) |
| D7 | B2B / B2C ke beech **3 m** | Zone par B2B/B2C; do alag type ke zones ke stalls 3 m door |
| D8 | Max **70%** area use (30%: electric shaft, paani, sweeper) | Utilization meter + publish se pehle check + AI 70% par rukega |
| D9 | Standard 6×6; 3 ya 4 club karke pavilion; ek ko do mein tod sakte | 6×6 size; multi-select → **Merge to pavilion**; split pehle se hai |
| D10 | Wall share ho to side-opening opposite | "Auto opposite" batch action |
| D11 | 300 stalls ek-ek nahi — **row/layer select karke** side open | Multi-select (Shift+click, row select) + batch side-open |
| D12 | "80% khaali dikh raha hai" — AI ko improve karo; zones ke hisaab se | AI sirf sellable zones mein, **bada zone pehle**, 70% cap |
| D13 | Dashboard: "itne stall kate, itna use hua"; rule override dikhe aur navigate ho | Stats + issues list (pehle se hai) + utilization |
| D14 | Publish ke time "ye 3 issues abhi bhi hain" + "yahan khaali hai, idhar karo" | Pre-publish dialog: issues, empty-space suggestions, override note |
| D15 | Publish par numbering + pricing policy; **pricing abhi nahi chahiye** | Publish = status + numbering. Pricing Phase 2 (ITPO price-master model ready hai) |
| D16 | Discussions record karo | Process: har meeting record + transcript repo mein (docs/meetings) |

Not now (Phase 2+): pricing/Excel price upload, EMC rules & markup, booking flow polish, CAD-style UI polish.

## 3. Current state (code audit, corrected)

Done and reusable:
- Step 1 import: PDF/CAD/DXF hall import, stall extraction from PDF (Hall 12A rotation bug fixed).
- Rule engine (ITPO D-rules): boundary, overlap, wall clearance, open-side passage, restricted zones, entry/exit access; live audit + violations panel with "locate".
- AI assist (Groq/Gemini via backend): place / clear stalls; **rule changes via chat with Apply** (new).
- Per-stall **Rules panel** in the 3D planner (new); split stall; drafting workspace with MERGE.
- Exhibitor view + booking + SelfCare payload (extra; not needed for Thursday).

Meeting gaps addressed by WP1–WP7: zones (D1, D2, D7), rules-first flow (D3), aisle 1.5 m (D4), emergency 3 m (D5), corner rule (D6), 70% (D8), pavilion merge (D9), auto-opposite + multi-select (D10, D11), AI spread (D12), publish (D14, D15).

## 4. Execution — step by step

Each WP: change → expected outcome → check.

### WP-1 · Meeting rules in the engine (D4, D5, D6, D8)
> **Status (3 October 2026): implemented and verified.** Passage range is 1.5–5 m (default remains 3 m); emergency access keeps at least 3 m; `cornerKeepOut` defaults on and emits `CORNER_PASSAGE`, including rotated/custom footprints and irregular hall corners. Rule values persist through save/update/reload.
> Validation: 487 backend unit tests passed (3 existing skips), 11 placement API tests passed, and 71 selected frontend geometry/browser checks passed including targeted reruns after correcting legacy test expectations/selectors/routes. Backend type-check and Angular production build passed; existing CSS-budget/CommonJS warnings remain.
> Scope: WP-1 stores `maxUtilization: 0.7` and `eventSeparation: 3`. Zone separation enforcement is implemented in WP-2; utilization enforcement and publication are implemented in WP-4/WP-6.
- Passage min 1.5 m (max 5 m) everywhere: frontend engine/store/toolbar, backend validation, AI intent, tests.
- Emergency exit access depth ≥ 3 m.
- Corner keep-out as a switchable rule (`CORNER_PASSAGE`), default on.
- Rule values `maxUtilization: 0.7`, `eventSeparation: 3` in hall rules.
- **Outcome:** aisle 1.5 m accept hota hai, 1 m reject; emergency door ke aage 3 m khaali; hall corner par stall reject; values save hoti hain.

### WP-2 · Zones (Step 2) (D1, D2, D7)
> **Status (3 October 2026): Implemented and verified: drawing/coordinate editing, rename/retype/delete, colour/labels, persistence, internal-zone exclusion, actual-footprint containment and cross-event separation. Invalid/overlapping/outside zones are refused atomically.**
- `hall.planningZones`: `{id, kind: MEDIA|ADMIN|FOOD|EXHIBITION, label, polygon, eventType}`; DB column + validation.
- 3D planner: **"Draw zone"** mode — drag a rectangle, choose type; zones tab to rename/retype/delete.
- Engine: stall in Media/Admin → violation; stalls of B2B and B2C zones ≥ 3 m apart.
- **Outcome:** user hall par 4 zones kheenchta hai, colour aur naam dikhte hain; Media/Admin mein stall nahi ban sakta; save/reload par zones wapas aate hain.

### WP-3 · Rules-first guided chat (D3, D9)
> **Status (3 October 2026): Implemented and verified: seven-rule Agree/Modify gate, size/zone/count-or-fill choices and proposal. Hall, rule or zone changes invalidate agreement. Invalid input stays in the form with an actionable error.**
- Chat open hote hi **"Standard rules" card**: 7 rules + current values; **Agree** ya **Modify** (inline values).
- Agree ke baad **size step**: zone, stall size (3×3, 3×2, 6×6, custom), count ya "fill", phir AI proposal.
- **Outcome:** user bina kuch type kiye rules confirm karke "Exhibition zone 6×6 fill" proposal tak pahunchta hai.

### WP-4 · AI cutting inside zones (D12, D8)
> **Status (3 October 2026): Implemented and verified: selected/all sellable zones, largest first, closed shared walls, actual-footprint checks and remaining utilization budget. Apply rechecks the current layout, including the cap, before adding stalls.**
- Backend planner: zones aaye to sirf Food/Exhibition mein, **bade zone pehle**; Media/Admin avoid; 70% cap.
- **Outcome:** "fill" karne par stalls sellable zones mein phailte hain (ek kone mein jama nahi), aur kul area 70% se upar nahi jata.

### WP-5 · Multi-select & batch side-opening (D9, D10, D11)
> **Status (3 October 2026): Implemented and verified: Shift/Ctrl selection, checkboxes, row/all selection, atomic side set/toggle/opposite, batch cancellation and gap-free 3–4-stall pavilion merge. Booked/gapped/nonrectangular merge inputs are refused; numbered parents retain cancelled identifiers.**
- Shift+click / Ctrl+click multi-select, "Select row", Select all; batch toolbar: set open side, toggle side, **Auto opposite** (shared wall), **Merge to pavilion**, cancel.
- **Outcome:** 10 stalls ki row ek click mein FRONT open; 3–4 stalls merge hoke ek pavilion banta hai.

### WP-6 · Dashboard, pre-publish check & Publish (D13, D14, D15)
> **Status (3 October 2026): Implemented and verified: actual-floor utilization, placement issues and Locate, bounded empty-space suggestions, server-rechecked publish with a required override reason when issues remain, numbering and persisted publication metadata. Editing returns to Draft. Pricing remains Phase 2.**
- Utilization meter (hall floor ka %; 70% limit line).
- **Publish** button → dialog: rule issues (locate), 70% status, "yahan khaali hai" suggestions; issues hon to "Publish anyway" with reason (override record hota hai).
- Backend: `layouts.status` (DRAFT/PUBLISHED), `published_at`, `publish_overrides`; `POST /api/layout/:id/publish`; numbering pehle se save par hoti hai.
- **Outcome:** published layout ke stalls numbered, status "Published", overrides recorded; exhibitor view se dekhne layak.

### WP-7 · Demo prep
> **Status (3 October 2026): Implemented and rehearsed: imported Hall 12A copy with four illustrative zones, empty editable start (layout 1093), published 75-stall backup (layout 1094), reproducible fixture script and a 10-minute Hinglish guide. Full real-backend browser rehearsal passed through guided fill, save, publish, numbering and exhibitor view.**
- Demo hall (Hall 12A import) with zones; demo script (Hinglish).
- **Outcome:** 10-minute end-to-end demo bina rukawat.

## 5. Original timeline (Thursday demo)

| When | Work |
|---|---|
| Day 1 | WP-1, WP-2 |
| Day 2 | WP-3, WP-4 |
| Day 3 | WP-5, WP-6 |
| Day 4 (demo day morning) | WP-7, rehearsal, buffer |

Descope order if late: Merge to pavilion → suggestions in publish dialog → guided size step (keep rules card).

## 6. Testing

- Unit/spec: rule engine (1.5 m, 3 m emergency, corner, separation, internal zone), zone validation (backend), utilization maths, AI planner in zones + 70% cap, publish endpoint.
- Browser: draw zones → guided chat → fill → multi-select side-open → publish → exhibitor view.
- Existing suites stay green (backend jest; frontend build + specs).

## Delivery and verification (3 October 2026)

All seven work packages are implemented. Pricing/Excel price upload, EMC policy/markup, booking polish and broader CAD UI redesign remain outside this delivery as agreed above.

- Backend: 501 unit tests passed, 3 existing skips; 15 placement/workflow API checks passed.
- Frontend: 329 full-suite unit tests plus 4 final store-guard tests passed; production build passed. All 106 selected browser regressions passed across the initial run and targeted reruns, plus 2 meeting-rule UI checks. New workflow browser coverage includes zone drawing/persistence, guided agreement/fill, atomic row edits/merge, override reason, publication and exhibitor view.
- Final backend type-check/build passed; complete verification outcomes are recorded in `../backend-nest/docs/meeting-validation.md`.
- UI finish review: ship; the sole requested PRODUCT.md persistence fix was scored resolved. DESIGN.md and the planner brief record the existing interface. No new visual identity or generated artwork was introduced.
- Local development schema migration applied; no remote deployment performed. Angular CSS-budget and polygon-clipping CommonJS warnings remain.
- Demo and recovery commands: [10-minute guide](../backend-nest/docs/meeting-demo.md). Prepared zone assignments are illustrative, not an approved venue allocation.

## 7. Risks

| Risk | Mitigation |
|---|---|
| AI provider down / rate-limited in demo | Simple parser fallback already; demo prompts tested; pre-saved layout as backup |
| Corner rule flags many existing perimeter stalls | Switchable; guided card lets user turn it off |
| Changing passage range affects saved layouts | Only the minimum is lowered; existing values stay valid |
| Time | Descope order above; pricing/EMC explicitly out |


## Phase 2 — pricing milestone (3 October 2026)

User chose editable rates and EMC markup. This next-phase milestone is implemented locally:

- Persistent price masters with optimistic revisions; bare/shell rates start blank.
- Excel template, complete import preview and atomic validation (500 rows / 2 MB workbook).
- Configurable open-side premiums, catalogue, explicit tax mode, EMC markup/fixed charge and optional EMC tax.
- Explicit price-revision assignment to a saved layout, returning it to Draft.
- Stall price previews and server-verified published-layout booking quotes; accepted receipts survive saves.
- Stale/tampered quotes, duplicate booking and stale editor overwrites are rejected.
- Focused, visible error recovery with retained form values; desktop/mobile workflow coverage.

Use **Layouts → Pricing & EMC**. Actual commercial rates have not been seeded into the demo layouts. Verification: 501 existing backend tests + 21 new pricing tests; 341 frontend tests; six pricing API tests; two complete desktop/mobile browser workflows. Backend and frontend builds pass with the existing frontend warnings.

Remaining: EMC permissions/approval policy, payment and hold/cancellation workflow, external SelfCare synchronization, broader CAD work and production deployment. Phase 2 as a whole is still in progress. API and business rules: [pricing milestone](../backend-nest/docs/pricing-phase-2.md).

## Editor refinement milestone (3 October 2026)

Implemented locally: native per-zone colour editing and Auto colour; consistent saved zone identities in 3D/CAD; metadata edits that preserve polygon and order; explicit rectangular coordinate edits; visible CAD Fit plan/Pan and a Planning & restricted zones layer; cached drawing with live cursor/preview overlays; AI placement performance improvements; and removal of the exhibitor map’s floating Hall card while retaining its header.

Verification: 79 focused backend unit tests, 84 focused frontend tests, four dedicated test-database API checks, backend type-check and Angular development build passed. The API runner needed targeted cleanup of its verified test server after a Windows teardown hang, then exited 0. Real-browser zone save/reload, CAD navigation and 64-stall AI generate/apply/save checks passed on an owned scratch layout that was subsequently removed. Fresh visual finish review: ship, with no material fixes. Local benchmark comparisons and usage: [editor improvements](../backend-nest/docs/editor-improvements.md). This was not a full-suite rerun or production deployment.

Phase 2 remains incomplete: external SelfCare, EMC permissions/approval policy, payment and hold/cancellation workflows, production deployment and broader CAD work remain.
