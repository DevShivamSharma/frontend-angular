"""Draw the rebuilt roads, walkways and property boundary over the z18 satellite image.
Run: python scripts/overlay-venue-roads.py
Reads src/assets/venue/venue-site-detail.json (mapMask.roads, walkways.paths, propertyBoundary, affine)
and work/venue-surroundings/satellite-reference.json (the z18 fit), and writes
docs/aerial-reference/model-roads-vs-satellite-after.png in the parent project. Verification only; no tests.
"""
import json, math
from pathlib import Path
from PIL import Image, ImageDraw

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
print(json.dumps({'output': str(out), 'crop': box, 'roads': len(roads), 'walkways': len(walkways)}))
