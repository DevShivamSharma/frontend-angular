# Geographic context sources

## Color mode satellite background

`satellite/satellite-inner.jpg` and `satellite/satellite-outer.jpg` are the original bundled **Esri World Imagery** mosaics restored byte-for-byte from frontend commit `7a7c98c79a53099c704fe95da6f271097b4d4e66`. Credit: **Esri, Maxar, Earthstar Geographics, and the GIS User Community**. These are historical images, not live tiles. The full imagery credit is visible in the Color venue view.

The original builder used 10 × 10 zoom-16 tiles and 6 × 6 zoom-13 tiles around 28.6180° N, 77.2443° E. `scripts/restore-venue-satellite.cjs` restores the JPEGs and their original four-landmark fit. The current model retains those layout coordinates: Convention Centre at approximately (-340, 132) and Hall 1 at (152, 233) in scene X/Z metres. Photo registration therefore retains the fitted rotation/scale instead of using the OSM context's approximate geographic origin. The manifest preserves the original fit and its 2.2–6.9 metre residuals; these are historical fit measurements, not a new survey of the detailed model. Source service: https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer

Images load on the first Color switch and are reused. Natural retains the OSM map; Color also falls back to OSM if a satellite asset fails. Both images must load before switching the background. A later Color switch retries a failed load. Imagery shares the local map's altitude fade during globe navigation and is disposed with the viewer.

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
