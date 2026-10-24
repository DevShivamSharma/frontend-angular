# Geographic context sources

## Color mode satellite background

`satellite/satellite-inner.jpg` and `satellite/satellite-outer.jpg` are the original bundled **Esri World Imagery** mosaics restored byte-for-byte from frontend commit `7a7c98c79a53099c704fe95da6f271097b4d4e66`. Credit: **Esri, Maxar, Earthstar Geographics, and the GIS User Community**. These are historical images, not live tiles. The full imagery credit is visible in the Color venue view.

The original builder used 10 × 10 zoom-16 tiles and 6 × 6 zoom-13 tiles around 28.6180° N, 77.2443° E. `scripts/restore-venue-satellite.cjs` restores the JPEGs and their original four-landmark fit. The current model retains those layout coordinates: Convention Centre at approximately (-340, 132) and Hall 1 at (152, 233) in scene X/Z metres. Photo registration therefore retains the fitted rotation/scale instead of using the OSM context's approximate geographic origin. The manifest preserves the original fit and its 2.2–6.9 metre residuals; these are historical fit measurements, not a new survey of the detailed model. Source service: https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer

Images load on the first Color switch and are reused. Natural retains the OSM map; Color also falls back to OSM if a satellite asset fails. Both images must load before switching the background. A later Color switch retries a failed load. Imagery shares the local map's altitude fade during globe navigation and is disposed with the viewer.

## Color → Map surroundings (25 October 2026)

`venue-surroundings.json` contains **© OpenStreetMap contributors** data under the **ODbL**: https://www.openstreetmap.org/copyright . It is derived from the same saved nearby OSM map extract as `venue-map-context.json`, not a new survey or live download. The compact, reproducible input is `work/venue-surroundings/osm-surroundings.json`; run `node scripts/build-venue-surroundings-context.cjs` to rebuild the runtime file. Its source URL and input SHA-256 are recorded in the output.

All footprints and railway centre lines pass through the shared **lat/lon → zoom-18 pixel → satellite-reference.json fit** in `build-venue-map-context.cjs`. Heights, track gauges and widths use the same 1.056 venue-metres/ground-metre scale. The 484 building pieces retain courtyard holes. Twenty-six have OSM `height` or `building:levels`; the rest use explicit type/landmark estimates, recorded per feature. The Supreme Court's main wings are not raised to the height of its dome. The 90 railway and four elevated metro sections are separate systems; unobserved bridge/deck elevations and station heights are estimates. Underground lines are omitted.

The Crafts Museum's two building footprints and the National Science Centre's building footprint are associated with their OSM museum-site polygons. Only the buildings are extruded, bypassing the old illustrative property exclusion for these footprints. The shared property boundary and all navigation data remain unchanged.

Following feedback on the photo-heavy first version, **Color → Map no longer displays a satellite image overlay**. Existing modeled roads, ground, trees and registered OSM surfaces form the ground. The bundled imagery remains a registration/reference source and is available through the existing explicit Satellite scenery. No imagery was downloaded or added. No Google imagery or Photorealistic 3D Tiles are used.

The runtime uses six shared material batches with vertex colours: building volumes, parapets/floor bands/sills, window panels, raised ballast/rails, bridge structures, and sleepers. Materials respond to scene lighting; Map ground surfaces receive shadows. Small façade and sleeper geometry uses distance LOD, while buildings stay 3D. Metro platforms, piers, columns and a curved roof replace a solid station block. These details are inferred visual geometry, not measured façades or station engineering. There are no added textures. Natural and Color → Satellite retain their existing scenery; failed new data loads retain the previous volumes. See `work/venue-surroundings/README.md` for comparison findings and limitations.

## Earth

`earth-day.jpg` is NASA Earth Observatory's **Blue Marble: Next Generation, July 2004**, downloaded at the publisher's 2048 × 1024 rendition. Credit: **NASA Earth Observatory**. The image is historical satellite-derived global surface imagery, not live imagery.

- Project, production and reuse credit: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/
- Publisher's downloads: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Exact asset: https://assets.science.nasa.gov/dynamicimage/assets/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg?w=2048&h=1024&fit=crop&crop=faces%2Cfocalpoint

The viewer reduces saturation in the material shader. The supplied JPEG itself is unchanged.

## Delhi streets and outlines

`delhi-context.json` contains simplified positions derived from **© OpenStreetMap contributors**, under the **Open Database License (ODbL)**: https://www.openstreetmap.org/copyright

The distant context was retrieved 26 September 2026 through https://overpass.kumi.systems/api/interpreter. On 27 September 2026 the nearby context was restored from the public OSM map API: https://api.openstreetmap.org/api/0.6/map?bbox=77.231,28.606,77.257,28.631 . The JSON keeps source metadata and input/model hashes under `nearby`.

The nearby square extends 1,100 metres from the existing origin in each direction. Features are clipped offline against the union of transformed `SITE_GROUND`, low admin ground slabs/lawns, campus paths and Gate 6 entry apron extracted from `outputs/outputs/IITF_2026_ARCHITECTURAL.glb`, replacing the previous oversized exclusion area. The downloaded ways supply roads, footpaths, building footprints, green areas and water; this is a simplified context map, not complete cartography. Road widths missing from OSM use illustrative defaults. The home viewer renders buildings as flat footprints and fades distant details between 1.8 and 3.5 km from the origin. These are contextual outlines, not building reconstructions or live map tiles. The campus-to-map registration remains approximate.

Coordinate origin: latitude 28.6185° N, longitude 77.2440° E. Local axes: east +X, up +Y, south +Z. The Earth uses a 6,371,000 metre sphere, with this location at the venue tangent origin.

Nearby building walls and roofs in `venue-site-detail.glb` use three Poly Haven CC0 textures (https://polyhaven.com/license): `concrete_wall_004`, `red_sandstone_wall` and `concrete_floor_02`, kept at 1k diffuse / 512 normal jpg in `work/venue-surroundings/textures/`. `facade_plaster_*` is `concrete_wall_004` with a drawn window tile (`scripts/make-facade-texture.py`). The nearby building blocks in that GLB are extruded from OpenStreetMap footprints (ODbL, via `venue-map-context.json`).
