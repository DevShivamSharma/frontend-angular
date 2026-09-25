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
 * One shared loader, and one promise per URL: a hall repeats the same three icons several times
 * and re-renders on every state change, so the icons are fetched and decoded once.
 */
const textureCache = new Map<string, Promise<THREE.Texture | null>>();

function loadTexture(url: string): Promise<THREE.Texture | null> {
  const cached = textureCache.get(url);
  if (cached) return cached.then(t => t?.clone() ?? null);

  const pending = new Promise<THREE.Texture | null>(resolve => {
    new THREE.TextureLoader().load(
      url,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      },
      undefined,
      () => {
        console.warn(`Amenity icon missing: ${url}`);
        resolve(null);
      }
    );
  });

  textureCache.set(url, pending);
  return pending.then(t => t?.clone() ?? null);
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
