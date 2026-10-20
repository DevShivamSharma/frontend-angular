"""Cut the 2D venue map image from the z18 satellite and record how world X/Z maps onto it.
Run: python scripts/build-venue-map-image.py
Reads work/venue-surroundings/satellite-reference.json (the z18 fit) and the z18 image in the parent
project's docs/aerial-reference, and writes src/assets/venue/geography/satellite/venue-map.jpg and
venue-map.json. The map is north-left (Mathura Road along the bottom), like the ITPO app's map. No tests.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/assets/venue/geography/satellite'
satellite = json.loads((ROOT / 'work/venue-surroundings/satellite-reference.json').read_text())
SX, SZ = satellite['fit']['x'], satellite['fit']['z']
# Venue plus the parking, metro and bus stop outside it, in z18 pixels; output width in pixels.
CROP, WIDTH = (1550, 820, 3250, 3700), 2400

det = SX[0]*SZ[1]-SX[1]*SZ[0]
def z18(x, z):
    x, z = x-SX[2], z-SZ[2]
    return ((x*SZ[1]-z*SX[1])/det, (z*SX[0]-x*SZ[0])/det)
x0, y0, x1, y1 = CROP
scale = WIDTH/(y1-y0)
def image(x, z):
    # Rotating the north-up crop 90 degrees anticlockwise sends crop pixel (u, v) to (v, width - u).
    px, py = z18(x, z)
    return ((py-y0)*scale, (x1-px)*scale)

source = Image.open(ROOT.parent / satellite['image']).convert('RGB').crop(CROP).rotate(90, expand=True)
picture = source.resize((WIDTH, round(source.height*scale)), Image.LANCZOS)
picture.save(OUT / 'venue-map.jpg', quality=80, optimize=True, progressive=True)

# image() is affine, so three points give its coefficients exactly.
o, ex, ez = image(0, 0), image(1, 0), image(0, 1)
worldToImage = {'u': [ex[0]-o[0], ez[0]-o[0], o[0]], 'v': [ex[1]-o[1], ez[1]-o[1], o[1]]}
assert all(abs(a-b) < 1e-6 for a, b in zip(image(151.5, 232.7), (
    worldToImage['u'][0]*151.5+worldToImage['u'][1]*232.7+worldToImage['u'][2],
    worldToImage['v'][0]*151.5+worldToImage['v'][1]*232.7+worldToImage['v'][2])))
(OUT / 'venue-map.json').write_text(json.dumps({
    'image': 'venue-map.jpg', 'size': list(picture.size), 'orientation': 'north-left',
    'source': satellite['source'], 'crop': list(CROP),
    'worldToImage': {k: [round(c, 8) for c in v] for k, v in worldToImage.items()},
    'note': 'u = a*x + b*z + c and v = d*x + e*z + f give image pixels for venue world X/Z (the satellite-reference.json fit).',
    'attribution': 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community'}, indent=2) + '\n')
print(json.dumps({'size': picture.size, 'bytes': (OUT / 'venue-map.jpg').stat().st_size, 'hall1': image(151.5, 232.7)}))
