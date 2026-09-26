# Home viewer conversion plan

Source: `frontend-angular/outputs/venue-explorer.html` and sibling files. The requested `output/index.html` does not exist. This is the copied current delivery, with a matching `Downloads/outputs/outputs` copy; `blender-prototype/output` was not used.

- Port the exact scene controller to TypeScript under the existing standalone HomePageComponent, AfterViewInit/OnDestroy and NgZone.runOutsideAngular.
- Preserve original HTML/CSS in a shadow root to isolate the vanilla document from planner styles. Add only a planner link.
- Retain DOM gallery, room/hall directory, readiness gate and geographic shader modules as isolated JavaScript with typed boundaries. Inject the component root, asset URL and abort lifetime; preserve their logic.
- Match Three.js 0.169.0 and its matching types. Keep only if build and planner tests pass.
- Copy runtime GLB, floorplans, geography, material and JSON assets into src/assets/venue, keeping their relative paths. Existing angular.json build assets entry already serves them. Record source inventory and GLB metadata separately.
- Preserve AgX exposure .86, SRGB, DPR cap 1.5, 4096 shadows, RoomEnvironment PMREM, SSAO and UnrealBloomPass/OutputPass, exact cameras and timers. Preserve globe and its shaders as a secondary control; venue is the initial view.
- Abort network work/listeners, cancel directory rendering, stop the animation loop, and dispose GPU resources on route exit. Keep late-load guards.
- Verify production build, ChromeHeadless tests, browser controls, screenshots and performance. Remove only positively unshared old home assets after usage checks.
