"""Draw the rebuilt roads, walkways and property boundary over the z18 satellite image.
Run: python scripts/overlay-venue-roads.py
Reads src/assets/venue/venue-site-detail.json (mapMask.roads, walkways.paths, propertyBoundary, affine)
and work/venue-surroundings/satellite-reference.json (the z18 fit), and writes
docs/aerial-reference/model-roads-vs-satellite-after.png in the parent project, plus
docs/aerial-reference/model-and-osm-roads-vs-satellite.jpg with the Color → Map OSM context
(src/assets/venue/geography/venue-map-context.json) over the whole z18 frame. Verification only; no tests.
"""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT.parent / 'docs/aerial-reference'
site = json.loads((ROOT / 'src/assets/venue/venue-site-detail.json').read_text())
satellite = json.loads((ROOT / 'work/venue-surroundings/satellite-reference.json').read_text())

# Reference-image pixel -> world (the site affine) -> z18 pixel (inverse of the similarity fit).
AX, AZ = site['affine']['x'], site['affine']['z']
SX, SZ = satellite['fit']['x'], satellite['fit']['z']
det = SX[0]*SZ[1]-SX[1]*SZ[0]
def world(p): return (AX[0]*p[0]+AX[1]*p[1]+AX[2], AZ[0]*p[0]+AZ[1]*p[1]+AZ[2])
def z18(q):
    x, z = q[0]-SX[2], q[1]-SZ[2]
    return ((x*SZ[1]-z*SX[1])/det, (z*SX[0]-x*SZ[0])/det)
to_image = lambda points: [z18(world(p)) for p in points]
metres_per_pixel = satellite['fit']['worldMetresPerPixel']

roads = [(r, to_image(r['points'])) for r in site['mapMask']['roads']]
walkways = [(w, to_image(w['points'])) for w in site.get('walkways', {}).get('paths', [])]
boundary = to_image(site['propertyBoundary'])

# Crop to the venue and the roads that frame it, clamped to the image.
image = Image.open(ROOT.parent / satellite['image']).convert('RGB')
xs = [p[0] for p in boundary]; ys = [p[1] for p in boundary]
box = [max(0, int(min(xs))-450), max(0, int(min(ys))-450), min(image.width, int(max(xs))+450), min(image.height, int(max(ys))+450)]
image = image.crop(box)
shift = lambda points: [(x-box[0], y-box[1]) for x, y in points]

overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)
def corridor(points, width, colour):
    draw.line(shift(points), fill=colour, width=max(1, round(width/metres_per_pixel)), joint='curve')
    for x, y in shift(points[:1]+points[-1:]):
        r = width/metres_per_pixel/2
        draw.ellipse([x-r, y-r, x+r, y+r], fill=colour)
for road, points in roads: corridor(points, road['width'], (255, 40, 40, 70))
for way, points in walkways: corridor(points, way['width'], (255, 170, 0, 90) if way['type'] == 'service' else (0, 220, 255, 90))
image = Image.alpha_composite(image.convert('RGBA'), overlay)
draw = ImageDraw.Draw(image)
for road, points in roads: draw.line(shift(points), fill=(255, 255, 255, 255), width=2)
for way, points in walkways: draw.line(shift(points), fill=(255, 220, 120, 255) if way['type'] == 'service' else (150, 245, 255, 255), width=2)
draw.line(shift(boundary+boundary[:1]), fill=(0, 255, 255, 255), width=3)
for road, points in roads:
    x, y = shift([points[len(points)//2]])[0]
    draw.text((x+8, y+4), road['id'], fill=(255, 255, 255, 255))
legend = ['Red corridor, white centreline: mapMask.roads', 'Orange: internal service roads (walkways.paths, type service)',
          'Cyan corridor: walkways (type path)', 'Cyan outline: propertyBoundary',
          f"z18 fit {satellite['fit']['worldMetresPerPixel']} world m/px, residuals {satellite['fit']['residualsMetres']}"]
draw.rectangle([10, 10, 620, 22+16*len(legend)], fill=(0, 0, 0, 170))
for i, line in enumerate(legend): draw.text((18, 16+16*i), line, fill=(255, 255, 255, 255))
out = DOCS / 'model-roads-vs-satellite-after.png'
image.convert('RGB').save(out, optimize=True)

# Second image: the Color → Map OSM context (venue-map-context.json, in world X/Z) over the whole z18 frame,
# with the traced roads, so OSM roads that the traced set replaces or that don't exist show up.
# Hatched = hidden under the site mask (mapMask polygons and road corridors), as venue-globe.ts does.
# Pass --natural to draw delhi-context.json instead: Natural renders that geographic-frame copy in world
# X/Z unchanged, which is how the Color → Map diagnosis (model-and-osm-roads-vs-satellite-before.jpg) was made.
natural = '--natural' in sys.argv
context = json.loads((ROOT / ('src/assets/venue/geography/' + ('delhi-context.json' if natural else 'venue-map-context.json'))).read_text())
full = Image.open(ROOT.parent / satellite['image']).convert('RGBA')
def in_frame(points): return any(0 <= x < full.width and 0 <= y < full.height for x, y in points)
mask = Image.new('L', full.size, 0)
mask_draw = ImageDraw.Draw(mask)
for ring in site['mapMask']['polygons']: mask_draw.polygon(to_image(ring), fill=255)
for road, points in roads: mask_draw.line(points, fill=255, width=round((road['width']+6)/metres_per_pixel), joint='curve')
osm = Image.new('RGBA', full.size, (0, 0, 0, 0))
osm_draw = ImageDraw.Draw(osm)
colours = {'park': (60, 255, 60, 70), 'water': (40, 140, 255, 110), 'road': (255, 0, 220, 150), 'arterial': (255, 0, 220, 170), 'local': (190, 80, 255, 150), 'service': (120, 160, 255, 140), 'path': (255, 255, 255, 90)}
osm_roads = 0
for feature in context['features']:
    if feature['k'] not in colours: continue
    points = [z18(p) for p in feature['p']]
    if not in_frame(points): continue
    if feature['k'] == 'road':
        osm_roads += 1
        colour = colours.get(feature.get('c'), colours['road'])
        if len(points) == 2: osm_draw.line(points, fill=colour, width=max(1, round(feature.get('w', 8)/metres_per_pixel)))
        else: osm_draw.polygon(points, fill=colour)
    else: osm_draw.polygon(points, fill=colours[feature['k']], outline=colours[feature['k']][:3]+(255,))
hidden = Image.new('L', full.size, 0)
hatch = ImageDraw.Draw(hidden)
for i in range(-full.height, full.width, 14): hatch.line([(i, 0), (i+full.height, full.height)], fill=255, width=5)
osm.putalpha(ImageChops.multiply(osm.getchannel('A'), Image.composite(hidden, Image.new('L', full.size, 255), mask)))
second = Image.alpha_composite(full, osm)
draw = ImageDraw.Draw(second)
for road, points in roads: draw.line(points, fill=(255, 255, 255, 255), width=3)
for road, points in roads:
    x, y = points[len(points)//2]
    draw.text((x+8, y+4), road['id'], fill=(255, 255, 0, 255))
legend = [('delhi-context.json as Natural draws it' if natural else 'venue-map-context.json (Color → Map): magenta arterial, purple local, blue service, white paths')
          + '; hatched where the site mask hides them', 'Green: OSM parks, blue: OSM water',
          'White: traced roads (mapMask.roads), labelled by id', f'{osm_roads} OSM road features inside the z18 frame']
draw.rectangle([10, 10, 900, 22+16*len(legend)], fill=(0, 0, 0, 190))
for i, line in enumerate(legend): draw.text((18, 16+16*i), line, fill=(255, 255, 255, 255))
out_osm = DOCS / ('model-and-osm-roads-vs-satellite' + ('-natural' if natural else '') + '.jpg')
second.convert('RGB').save(out_osm, quality=85)
print(json.dumps({'output': str(out), 'crop': box, 'roads': len(roads), 'walkways': len(walkways), 'osmOutput': str(out_osm), 'osmRoads': osm_roads}))
