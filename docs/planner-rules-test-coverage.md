# Planner rules guide: verification map

The guide opens on each planner visit, can be dismissed with its main action, close button or Escape, and can be reopened from the Rules tab. Its current passage, wall clearance and size step come from the active hall. The existing blue/white planner styling is preserved; the brand icon now depicts a floor plan.

## Run

```powershell
$env:PW_PORT = '4200'
$env:PW_RUN_ID = 'planner-rules-final'
npm run test:planner-rules
```

Port 4200 is allowed by the current local backend's CORS configuration. Port 4202 serves the frontend, but the backend rejects browser requests from that origin. No backend configuration is changed by this work.

The command includes browser integration checks, pure geometry checks executed by the Playwright runner, and two genuine backend persistence checks. They are deliberately distinguished. Most browser tests intercept API calls to make hall geometry and server failures deterministic; Angular's development API is used for fixture setup and state observations, while editing, form submissions, chat, file imports, drawing and dragging use actual rendered controls/pointer events. No production test hooks are added.

## Guide-to-test mapping

| Visible rule topic / stable ID | Checks |
|---|---|
| `floor-grid` | Positive step multiples; invalid dimensions rejected; edge snapping; rectangular/circular/irregular containment; floor holes; disconnected regions |
| `passage-openings` | Exact 3 m/5 m limits and insufficient gaps; all four opening directions; full frontage within floor; at least one opening; multiple openings; existing frontage protected |
| `walls-zones` | Peripheral clearance boundary; all eight zone types including hidden restrictions; individual buffer override; entry/exit/service/emergency access; walkable versus physical frontage obstacles |
| `touching-corners` | Opposite outward openings and positive shared edge; invalid same-facing/point contact; polygon/notch corners; exterior gap rejection; rotated contacts; no synthetic circular corner |
| `editing` | Invalid drag rollback with actual pointer input; valid/overlapping canvas drawing; typed movement; resize rejection; quarter-turn and numeric rotation; duplicate placed in fresh valid space |
| `save-audit` | Existing invalid settings/layout stay visible; writes blocked before request; structured backend rejection; saved-layout audit; genuine save/reload including geometry, passage, rotation, openings and numbers |
| `settings-geometry` | Current hall/event values displayed; B2B/B2C settings independent; invalid passage ranges; changing rules audits existing layout; snapping does not disable validation |
| `status-split` | BOOKED occupancy; CANCELLED space release/number retention; unnumbered removal; AVAILABLE-only split; 2–100 integer count bounds; equal snapped child sizes; passage reservation; two-child back-to-back; corner and rotation checks; suffixes beyond Z; provisional preview; dirty-layout guard; concurrent-edit guard; unavailable endpoint; server rejection; genuine child persistence |
| `assist-import` | Actual chat review/apply, changed fit count re-review, stale removal/hall invalidation; Excel outside-row filtering and overlapping-row audit; SelfCare hidden restriction import; local master-hall save guard; offline fallback and unsaved reload behaviour |
| `helpers-limits` | Locate and suggested placement; hiding guides retains validation; free-space count represents alternatives; active-area/nominal occupancy and cancelled-inclusive totals |

## Pop-up and accessibility checks

- Opens automatically, includes all ten topics, updates active settings without reopening during editing.
- Blocks background plotting while open; keyboard focus stays inside; Escape/close/main action work; focus returns to the relevant control.
- Reopens from Rules; reload shows it again; sidebar icon and existing home link remain correct.
- Desktop 1440 × 1000, mobile 390 × 844, small mobile 320 × 568 and landscape 844 × 390: dialog stays in viewport, content scrolls, all details can be read, and plotting is usable after dismissal.

## Boundaries of the verification

“100%” can describe all enumerated tests passing; it cannot prove every possible layout, browser, concurrency sequence or external safety requirement. The ten guide topics have explicit checks in the suite. This is not a statement/branch coverage measurement.

Height limits, structural loads and full evacuation routing are disclosed limitations, not implemented rules claimed as passing. AI proposal validation is exercised with controlled responses; model quality/provider availability is not certified. Backend tests create uniquely named test layouts and remove only those records in `finally` blocks. An unavailable backend/split endpoint is reported as skipped, never passed.

## Results

Verified on 27 September 2026 using the repository's Playwright browser configuration and actual local Angular application. **All 66 enumerated scenarios have a passing latest result across the complete run and the focused confirmation run.** This is not a claim that a single clean 66/66 run occurred.

| Run | Actual result | Follow-up |
|---|---|---|
| `planner-rules-review`, port 4202 | 59 passed, 5 failed, 64 cases | Exposed the existing backend CORS restriction, keyboard focus wrapping, and compact viewport controls. Added explicit focus wrapping and improved compact viewport sizing; used backend-supported port 4200 for subsequent tests. |
| `planner-rules-final`, port 4200 | 64 passed, 2 failed, 66 cases; no skips/flaky results; 9m 26s | Landscape canvas had no usable height; the new drawing fixture projected coordinates with a stale camera matrix. Fixed stage flex sizing and updated the fixture camera matrix before projection. Genuine backend save/reload and split/reload both passed. |
| `planner-rules-confirm`, port 4200 | **8 passed**, no failures/skips/flaky results; 2m 9s | Rechecked all six guide cases, actual canvas drawing, and the existing mobile split flow after the fixes. Covers desktop, both portrait sizes, landscape, focus, Escape, reopening, active settings and plotting after dismissal. |

The 66 cases comprise **50 browser scenarios** (48 with controlled API/offline fixtures, 2 with the genuine backend) and **16 pure geometry scenarios**. The latest per-case summary reports 66 passed and zero outstanding non-passing cases. All ten displayed rule topics have explicit test mappings above. The final changes do not modify placement calculations or 3D rendering loops.

Final validation:

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build`: passed. Existing warning categories remain: initial bundle 1.84 MB exceeds the 1.50 MB warning budget by 337.38 kB; `polygon-clipping` uses CommonJS.
- `git diff --check`: passed; Git reports Windows line-ending normalization notices.
- Popup screenshots inspected at all four viewport sizes. Long rule content scrolls while the dismiss action remains accessible.
- Test-created backend records were cleaned up, including the uniquely identified record left by the interrupted initial CORS test. User layouts were not removed. No backend code or configuration was changed.

Focused confirmation command:

```powershell
$env:PW_PORT = '4200'
$env:PW_RUN_ID = 'planner-rules-confirm'
npm run test:planner-rules -- --grep 'guide:|actual canvas drawing|mobile split'
```

## Reports and screenshots

- [Complete-run HTML report (retains the two diagnosed failures)](../playwright-report/planner-rules-final/index.html)
- [Focused confirmation HTML report: 8/8 passed](../playwright-report/planner-rules-confirm/index.html)
- [Latest outcome per case, with source run retained](../test-results/planner-rules-verified-summary.json)
- [Complete-run raw results](../test-results/planner-rules-final/results.json)
- [Confirmation raw results](../test-results/planner-rules-confirm/results.json)
- [Desktop popup](../test-results/planner-rules-confirm/artifacts/planner-rules-guide-auto-o-0ac11-nd-changes-the-sidebar-icon/rules-desktop.png)
- [Mobile 390 × 844](../test-results/planner-rules-confirm/artifacts/planner-rules-guide-readable-and-dismissible-at-390x844/rules-390x844.png)
- [Small mobile 320 × 568](../test-results/planner-rules-confirm/artifacts/planner-rules-guide-readable-and-dismissible-at-320x568/rules-320x568.png)
- [Landscape 844 × 390](../test-results/planner-rules-confirm/artifacts/planner-rules-guide-readable-and-dismissible-at-844x390/rules-844x390.png)

Reports and screenshots are local generated artifacts; their directories are ignored by Git.

## Files for this change

| Files | Purpose |
|---|---|
| `src/app/planner/components/planner-rules-dialog.component.{ts,html,css}` | Accessible, responsive guide with current hall settings, ten rule topics, modal focus handling and reopen support |
| `src/app/planner/planner-page.component.{ts,html,css}` | Open guide on entry, add Rules-tab entry point, use new icon, preserve usable compact viewport controls/canvas |
| `src/app/planner/components/icon.component.{ts,html}` | Add the floor-plan SVG icon |
| `e2e/planner-rules.spec.ts`, `e2e/planner-test-helpers.ts` | Rule/UI verification and deterministic fixtures |
| `e2e/stall-editor.spec.ts`, `e2e/backend-persistence.spec.ts` | Dismiss the new entry guide in existing regression flows |
| `package.json` | Add `npm run test:planner-rules` |
| `docs/planner-rules-test-coverage.md` | Rule-to-test mapping, actual run history, artifacts and limitations |

Pre-existing workspace changes and the separate Hinglish meeting notes were retained.
