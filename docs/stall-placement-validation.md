# Stall placement delivery and verification

Frontend implementation in `frontend-angular`; no backend source changes were made.
The existing API was inspected read-only through the codebase graph and source.

## Blank-page follow-up: normal development startup

The user's blank page was reproduced on the running normal `npm start` server. Its browser
error was: `polygon-clipping.js does not provide an export named 'difference'`. The library's
browser build exposes a default object, while the previous code imported runtime named exports.
The original suite used disabled prebundling and therefore did not cover this failure.

`polygon-geometry.ts` and `oriented-placement.ts` now use the default runtime export and
type-only named imports. `playwright.config.ts` now uses normal Vite prebundling and the same
localhost server as `npm start`. `e2e/app-startup.spec.ts` adds direct home/planner startup checks
that capture JavaScript errors without API mocks.

- `$env:PW_RUN_ID='startup-fix-20260927'; npm run test:e2e`: **30 passed, 0 failed, 0 skipped; exit 0**.
  This includes both startup cases, all previous placement cases and real backend persistence.
- `npm run build -- --output-path=dist/startup-fix-20260927`: **passed, exit 0**;
  the existing 1.81 MB bundle-size and CommonJS warnings remain. Log: `tmp/build-startup-fix.log`.
- [Updated HTML report](../playwright-report/startup-fix-20260927/index.html)
- [Updated JSON results](../test-results/startup-fix-20260927/results.json)
- [Planner loaded with the real hall](../test-results/startup-fix-20260927/artifacts/app-startup-startup-planne-27575-ut-JavaScript-module-errors/planner-loaded.png)
- [Home page loaded](../test-results/startup-fix-20260927/artifacts/app-startup-startup-renders-without-JavaScript-module-errors/home-loaded.png)
- Log: `tmp/playwright-startup-fix.log`. The unit suite below was not rerun for this import fix.

The remaining sections record the initial delivery and its artifacts.

## Changed files

Paths in this document are relative to the frontend repository.

| Files | Change |
| --- | --- |
| `src/app/planner/geometry/placement-rules.ts`, `hall-rules.ts` | Consistent 3–5 m passage, irregular corners, usable floor, open-frontage and touching rules for every hall. |
| `src/app/planner/geometry/polygon-geometry.ts`, `oriented-placement.ts` | Actual rotated polygon edges, outward normals, floor containment and clear frontage. |
| `src/app/planner/geometry/free-space.ts` | Orientation-aware free-space search and disconnected floor regions. |
| `src/app/planner/geometry/stall-split.ts` | Equal-child preview, reserved passages, back-to-back pair and opaque parent suffixes A…Z, AA…. |
| `src/app/planner/planner-store.service.ts` | Shared validation across creation, edits, drag, rotate, plan, split and save; server-authoritative split with retry key and edit guards. |
| `src/app/planner/layout-api.service.ts`, `models/layout.model.ts`, `models/stall.model.ts`, `geometry/planner-geometry.ts` | Existing API integration and restored rotation, open sides, rules, server identifiers and lineage. |
| `src/app/core/http-error.util.ts` | Backend message arrays and validation feedback. |
| `src/app/planner/components/editor-toolbar.component.{ts,html}` | Passage width and drawing open direction. |
| `src/app/planner/components/edit-stall-form.component.{ts,html}` | Guarded dimensions, position, rotation, open sides and split controls. |
| `src/app/planner/components/violations-panel.component.{ts,html}` | Corner/open-side explanations and actionable placement feedback. |
| `src/app/planner/three/editor-overlay-renderer.ts`, `stall3d-renderer.ts`, `scene3d.component.css`, `src/styles.css` | Rotated stalls, invalid areas, readable saved identifiers, provisional child labels and responsive controls. |
| `src/app/planner/geometry/{free-space,placement-rules}.spec.ts`, `src/app/planner/planner-store.service.spec.ts` | Existing assertions updated for the requested rules. |
| `e2e/placement-geometry.spec.ts`, `e2e/stall-editor.spec.ts`, `e2e/backend-persistence.spec.ts`, `playwright.config.ts` | Executable geometry, actual app interaction and real backend tests. |
| `package.json`, `package-lock.json`, `.gitignore` | Playwright test command/dependency, polygon operations, ignored generated reports. |
| `docs/stall-placement-contract.md`, this file | Integration contract and verification evidence. |

## Coverage and environment

- Browser UI checks: 3/5 m exact-width acceptance and insufficient-width rejection; irregular
  notch corner and exterior frontage; valid touching pair; wrong open direction; rotation and
  resize rejection; real canvas drag and rollback; passage change and blocked save; auto-layout;
  split preview, server feedback, unsaved/concurrent edits and mobile controls.
- Pure geometry checks run under Playwright use the application's real validator, including
  holes, circles, disconnected floor regions, rotated edges, cancellation and suffixes after Z.
- Fixture tests are explicitly mocked and do not establish backend persistence.
- Real tests use `http://localhost:8080/api` and the actual Angular app. Only their own uniquely
  named layouts are created/deleted. Browser origin is `http://localhost:4200`, matching the
  backend CORS allowlist. No CORS bypass or mocked backend is used for these tests.
- Desktop viewport: 1440 × 1000; mobile: 390 × 844. Chromium uses software WebGL in this environment.

## Commands and results

Final run: 27 September 2026, local time (Asia/Kolkata).

| Command | Actual result |
| --- | --- |
| `$env:PW_RUN_ID='verified-20260927'; npm run test:e2e` (PowerShell) | **28 passed, 0 failed, 0 skipped; exit 0.** Fourteen pure geometry cases and fourteen browser cases, including two against the real backend. |
| `npm test -- --watch=false --browsers=ChromeHeadless` | **212 assertions passed**, followed by Angular's Windows temporary-directory cleanup `EPERM`; command exited **1**, so this is not reported as a clean runner pass. |
| `npm run build -- --output-path=dist/stall-placement-final-20260927` | **Passed, exit 0.** Production output generated from final source. |
| `npx tsc --noEmit -p tsconfig.app.json` | Passed during implementation; the final production build also compiled the application successfully. |
| `git -c core.safecrlf=false diff --check` | Passed. |

The production bundle is 1.81 MB, above the existing 1.50 MB warning budget but below its
2 MB error budget. Angular also reports a CommonJS optimization warning for `polygon-clipping`.

Earlier tests exposed a CORS-origin mismatch (`127.0.0.1` versus the backend's allowed `localhost`),
a test trying to click a hidden Stalls tab, and an incorrect 2 m gap in a geometry fixture. These
were corrected and rerun. Screenshot review also found unreadable saved labels; their layer and
minimum size were fixed and the real split test now checks their visibility and readable bounds.

Windows intermittently locks generated files. A repeat build targeting the default `dist` directory
failed with `EPERM`; the fresh output directory above built successfully. One earlier HTML reporter
stalled replacing old assets after all cases passed; it was interrupted and the full suite rerun
successfully into a fresh `PW_RUN_ID` folder. No failing run is counted as the final runner result.

## Reports and screenshots

- [Final Playwright HTML report](../playwright-report/verified-20260927/index.html)
- [Final machine-readable results](../test-results/verified-20260927/results.json)
- Logs: `tmp/playwright-verified.log`, `tmp/unit-tests.log`, `tmp/build-delivery.log`.
- Production files: `dist/stall-placement-final-20260927/browser/`.

| Screenshot | Path |
| --- | --- |
| Desktop split preview | [split-preview-desktop.png](../test-results/verified-20260927/artifacts/stall-editor-UI-split-prev-48064-ationship-and-mocked-reload/split-preview-desktop.png) |
| Mobile controls | [split-preview-mobile.png](../test-results/verified-20260927/artifacts/stall-editor-UI-mobile-split-controls-stay-reachable/split-preview-mobile.png) |
| Irregular corner rejection | [irregular-corner-rejection.png](../test-results/verified-20260927/artifacts/stall-editor-UI-irregular--431f5-t-gap-and-exterior-frontage/irregular-corner-rejection.png) |
| Invalid resize | [invalid-resize-desktop.png](../test-results/verified-20260927/artifacts/stall-editor-UI-back-to-ba-56fe9-en-side-rotation-and-resize/invalid-resize-desktop.png) |
| Real backend save/reload | [real-backend-reloaded.png](../test-results/verified-20260927/artifacts/backend-persistence-real-b-6cee8-en-sides-and-server-numbers/real-backend-reloaded.png) |
| Real backend split/reload | [real-backend-split-reloaded.png](../test-results/verified-20260927/artifacts/backend-persistence-real-b-3a5bf-point-and-child-persistence/real-backend-split-reloaded.png) |

Generated reports, logs, screenshots and build output are ignored by Git. The test scripts and
contract remain in the repository as source files. Use a new `PW_RUN_ID` if an old report folder is locked.

## Backend dependencies

The current local backend implements the save/update/load and atomic split contract documented
in [stall-placement-contract.md](stall-placement-contract.md), and both real integration tests passed.
No missing local backend endpoint blocks this delivery. Other deployments must provide
those same endpoints, rotation/open-side/rule persistence, server-generated suffixes,
`parentStallNumber`, `isSplitParent` and authoritative validation errors. A missing split endpoint
leaves the parent unchanged and displays an explicit dependency message.

Split confirmation requires a saved, current layout; dirty edits must be updated first. The server
remains authoritative even when frontend preview passes. Preview split currently creates 2–100
equal children on the existing size grid; back-to-back mode creates two children.
