"""Write the Color palette the explorer loads, venue-colour-materials-web.glb, from the supplied venue-colour-materials.glb.
Run: python scripts/compress-venue-palette.py
Opaque PNG tiles become JPEG (quality 90), photos wider than MAX_SIDE are scaled down; images with transparency
(the CC floor plans) and the materials themselves are kept as they are. The supplied file is left untouched. No tests.
"""
import io
import json
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'src/assets/venue/venue-colour-materials.glb'
OUTPUT = ROOT / 'src/assets/venue/venue-colour-materials-web.glb'
QUALITY, MAX_SIDE = 90, 2048

data = SOURCE.read_bytes()
json_length = struct.unpack_from('<I', data, 12)[0]
gltf = json.loads(data[20:20 + json_length])
binary = data[28 + json_length:]
by_view = {image['bufferView']: image for image in gltf.get('images', []) if 'bufferView' in image}
chunks, offset, report = [], 0, []
for index, view in enumerate(gltf['bufferViews']):
    start = view.get('byteOffset', 0)
    blob = binary[start:start + view['byteLength']]
    image = by_view.get(index)
    if image:
        picture = Image.open(io.BytesIO(blob))
        opaque = picture.mode in ('RGB', 'L') or (picture.mode == 'RGBA' and picture.getchannel('A').getextrema()[0] == 255)
        if opaque:
            picture = picture.convert('RGB')
            if max(picture.size) > MAX_SIDE:
                picture.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
            out = io.BytesIO()
            picture.save(out, 'JPEG', quality=QUALITY, optimize=True)
            # A PNG tile that would not get smaller stays a PNG.
            if out.tell() < len(blob) or image.get('mimeType') == 'image/jpeg':
                report.append((image.get('name', index), len(blob), out.tell(), picture.size))
                blob, image['mimeType'] = out.getvalue(), 'image/jpeg'
    padded = blob + b'\0' * (-len(blob) % 4)
    view['buffer'], view['byteOffset'], view['byteLength'] = 0, offset, len(blob)
    chunks.append(padded)
    offset += len(padded)
gltf['buffers'] = [{'byteLength': offset}]
gltf['asset'].setdefault('extras', {})['webTextures'] = f'scripts/compress-venue-palette.py from {SOURCE.name}: JPEG {QUALITY}, max {MAX_SIDE} px'
encoded = json.dumps(gltf, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
body = b''.join(chunks)
OUTPUT.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(body)) + struct.pack('<II', len(encoded), 0x4E4F534A)
                   + encoded + struct.pack('<II', len(body), 0x004E4942) + body)
for name, before, after, size in report:
    print(f'{name}: {before / 1e6:.2f} -> {after / 1e6:.2f} MB {size[0]}x{size[1]}')
print(f'{OUTPUT.name}: {len(data) / 1e6:.1f} -> {OUTPUT.stat().st_size / 1e6:.1f} MB')
