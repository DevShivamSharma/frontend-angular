import * as THREE from 'three';

import { iconUrlFor } from '../geometry/selfcare-layout';
import { HallAmenity } from '../models/hall.model';
import { makeTextSprite } from './text-sprite';

/** Side of an icon in metres. Large enough to read when the whole 133 m hall is in frame. */
const ICON_SIZE = 3;

/** Height above the floor. Above the zone fills (0.14) and below the marker text (1.6). */
const ICON_Y = 0.9;

/** Tint of the placeholder square shown until the SVG loads, per kind. Matches the SelfCare chips. */
const PLACEHOLDER_COLOR: Record<string, string> = {
  'toilet-male': '#60a5fa',
  'toilet-female': '#f0abfc',
  stairs: '#fb923c',
  'entry-up': '#94a3b8'
};

/**
 * Layer 9 — amenities: the SelfCare utility icons (toilets, stairs/elevators, entry arrows) as
 * camera-facing sprites with their caption underneath.
 *
 * Before this layer existed the planner had no consumer for `helper_text` at all, which is why
 * these icons were missing from every hall. They are visual only: an amenity never blocks a
 * stall, and SelfCare routinely places them OUTSIDE the hall outline (the Hall 10 toilet block
 * sits above FOYER C), so they must not be modelled as zones.
 *
 * Icons load asynchronously. Each sprite is drawn immediately as a tinted placeholder and gets
 * its texture when the SVG arrives, so a slow or missing asset never leaves a hole in the plan
 * and never blocks the frame.
 */
export function buildAmenities(amenities: HallAmenity[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'amenities';

  for (const amenity of amenities) {
    if (!Number.isFinite(amenity.position?.x) || !Number.isFinite(amenity.position?.z)) continue;

    group.add(buildIcon(amenity));

    const caption = makeTextSprite([amenity.label], {
      color: '#0f172a',
      background: 'rgba(255,255,255,0.92)',
      lineHeight: 0.62,
      bold: true
    });
    caption.position.set(amenity.position.x, ICON_Y, amenity.position.z + ICON_SIZE * 0.75);
    group.add(caption);
  }

  return group;
}

function buildIcon(amenity: HallAmenity): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: placeholderTexture(PLACEHOLDER_COLOR[amenity.kind] ?? '#94a3b8'),
    depthTest: false,
    transparent: true
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(ICON_SIZE, ICON_SIZE, 1);
  sprite.position.set(amenity.position.x, ICON_Y, amenity.position.z);
  sprite.renderOrder = 29;

  loadTexture(iconUrlFor(amenity.kind)).then(texture => {
    if (!texture) return;
    // The layer may already have been disposed while the SVG was in flight. `disposeLayer`
    // clears the scene group, which detaches this sprite's whole subtree — so a sprite that no
    // longer reaches the scene has a dead material, and its texture must be released here.
    if (!isAttachedToScene(sprite)) {
      texture.dispose();
      return;
    }
    material.map?.dispose();
    material.map = texture;
    material.needsUpdate = true;
  });

  return sprite;
}

/**
 * Side of the rasterised icon texture, in pixels.
 *
 * The SelfCare icons declare an intrinsic size of 25 x 25, and a browser rasterises an SVG in an
 * `<img>` at exactly that — so `THREE.TextureLoader` would hand back a 25 px texture and the
 * icons would go soft as soon as the camera moved in. Drawing the SVG into a canvas of this size
 * instead re-rasterises it from the vector data, so it stays crisp at any zoom.
 */
const ICON_TEXTURE_PX = 128;

/**
 * One shared load per URL: a hall repeats the same few icons several times and re-renders on
 * every state change, so each SVG is fetched, decoded and rasterised once. Callers get a clone,
 * which shares that single GPU source but owns its own handle, so disposing one sprite's texture
 * with its layer never pulls the image out from under the others.
 */
const textureCache = new Map<string, Promise<THREE.Texture | null>>();

function loadTexture(url: string): Promise<THREE.Texture | null> {
  const cached = textureCache.get(url);
  if (cached) return cached.then(t => t?.clone() ?? null);

  const pending = rasterize(url);
  textureCache.set(url, pending);
  return pending.then(t => t?.clone() ?? null);
}

/** Load `url` and re-rasterise it into a square `ICON_TEXTURE_PX` canvas texture. */
function rasterize(url: string): Promise<THREE.Texture | null> {
  return new Promise<THREE.Texture | null>(resolve => {
    const image = new Image();
    // The icons are same-origin assets; this only keeps the canvas untainted if that ever changes.
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ICON_TEXTURE_PX;
      canvas.height = ICON_TEXTURE_PX;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      // Fit the icon inside the square without distorting a non-square source
      // (emergency-exit.svg is 26 x 25), and centre what is left over.
      const source = Math.max(image.naturalWidth || 1, image.naturalHeight || 1);
      const scale = ICON_TEXTURE_PX / source;
      const w = (image.naturalWidth || source) * scale;
      const h = (image.naturalHeight || source) * scale;
      ctx.drawImage(image, (ICON_TEXTURE_PX - w) / 2, (ICON_TEXTURE_PX - h) / 2, w, h);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      // The texture is drawn far smaller than 128 px when the whole hall is in frame, so let the
      // GPU mip it down rather than alias.
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      resolve(texture);
    };

    image.onerror = () => {
      console.warn(`Amenity icon missing: ${url}`);
      resolve(null);
    };

    image.src = url;
  });
}

/** True while `object` still hangs off a `THREE.Scene`, i.e. its layer has not been disposed. */
function isAttachedToScene(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object.parent; node; node = node.parent) {
    if (node instanceof THREE.Scene) return true;
  }
  return false;
}

/** A rounded, tinted square drawn on a canvas — shown until the real SVG texture arrives. */
function placeholderTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    // arcTo rather than ctx.roundRect, for the same reason text-sprite.ts rolls its own.
    const x = 6;
    const y = 6;
    const size = 52;
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
