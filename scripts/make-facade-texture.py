"""Facade tile for the OSM-footprint buildings in build-venue-surroundings.py.
One 3 m x 3 m tile = one floor with one recessed window, composited over the Poly Haven
concrete_wall_004 plaster so box-projected UVs in metres put a window row on every floor.
Run: python scripts/make-facade-texture.py   (writes work/venue-surroundings/textures/facade_plaster_*_1k.jpg)
"""
from pathlib import Path
from PIL import Image, ImageDraw

TEX = Path(__file__).resolve().parent.parent / 'work/venue-surroundings/textures'
PX = 1024 / 3  # pixels per metre on a 3 m tile
def box(x0, y0, x1, y1):  # metres from the tile's left edge and from the floor line (image bottom)
    return (round(x0 * PX), round(1024 - y1 * PX), round(x1 * PX), round(1024 - y0 * PX))

diffuse = Image.open(TEX / 'concrete_wall_004_diff_1k.jpg').convert('RGB')
normal = Image.open(TEX / 'concrete_wall_004_nor_gl_1k.jpg').convert('RGB').resize((1024, 1024))
d, n = ImageDraw.Draw(diffuse), ImageDraw.Draw(normal)
d.rectangle(box(0, 2.78, 3, 3), fill=(150, 142, 128))      # floor slab band
d.rectangle(box(0.62, 0.95, 2.38, 2.35), fill=(118, 112, 102))  # window reveal
d.rectangle(box(0.7, 1.0, 2.3, 2.3), fill=(72, 96, 110))   # blue-grey glazing, as the traced buildings' beams
d.rectangle(box(1.48, 1.0, 1.52, 2.3), fill=(150, 150, 150))  # mullion
d.rectangle(box(0.7, 1.63, 2.3, 1.67), fill=(150, 150, 150))  # transom
n.rectangle(box(0.62, 0.95, 2.38, 2.35), fill=(128, 128, 255))  # flat inside the reveal
for edge, colour in [(box(0.62, 0.95, 0.7, 2.35), (190, 128, 230)), (box(2.3, 0.95, 2.38, 2.35), (66, 128, 230)),
                     (box(0.62, 2.27, 2.38, 2.35), (128, 66, 230)), (box(0.62, 0.95, 2.38, 1.03), (128, 190, 230))]:
    n.rectangle(edge, fill=colour)  # reveal sides tilt the normal so the window reads recessed
diffuse.save(TEX / 'facade_plaster_diff_1k.jpg', quality=82)
normal.resize((512, 512)).save(TEX / 'facade_plaster_nor_gl_1k.jpg', quality=88)
print('wrote facade_plaster_diff_1k.jpg and facade_plaster_nor_gl_1k.jpg')
