# Geographic context sources

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
