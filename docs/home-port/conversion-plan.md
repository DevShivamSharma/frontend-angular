# Angular-native conversion plan — implemented

This supersedes the previous hybrid plan, archived at `angular-native/previous-hybrid-plan.md`.

Source used for this conversion and browser comparisons: `C:/Users/Shivam Sharma/Downloads/outputs/outputs/venue-explorer.html` and sibling files. The previous port used the matching copied `frontend-angular/outputs` delivery; that folder is absent in the current checkout. No `output/index.html` was found. `blender-prototype/output` is not the viewer.

1. Preserve source constants, source assets, CSS, node names, camera motion, loading weights, API requests and UI behavior. Keep the already pinned Three.js 0.169.0 and installed dependencies unchanged.
2. Make HomePageComponent own the canvas, menus, buttons, status, active selections and route link through Angular templates and bindings. Use standalone OnPush components, AfterViewInit/OnDestroy, and Angular ShadowDom encapsulation to retain CSS isolation.
3. Convert loading gate, details, room/hall browsers, photo gallery and floor-plan dialog into Angular templates/components. Put directory parsing, request caching and lifetime cancellation in a component-scoped typed service. Use typed signal state for loading and UI updates.
4. Convert globe JavaScript to TypeScript and narrow the existing TypeScript scene controller to canvas rendering, camera/selection commands and typed callbacks. Keep the render loop outside NgZone; enter Angular only for UI state changes. Native WebGL controls and native dialog operations remain browser APIs.
5. Delete the five obsolete plain-JavaScript modules and their declaration shims once no imports remain. Move the identical runtime CSS into Angular component styles; retain all source scene assets with identical bytes. Do not change planner, routes, global CSS, package versions, backend or database.
6. Validate production build, all existing and new unit tests, real API/browser interactions, retry and teardown, matching desktop/closeup/mobile screenshots and production performance. Record limits and all measurements rather than claiming unmeasured equivalence.

Nothing remains plain JavaScript from the supplied viewer. No iframe, injected HTML, runtime script loading or manual DOM construction remains in the home implementation.
