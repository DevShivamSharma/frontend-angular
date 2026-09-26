import * as THREE from 'three';

import { iconUrlFor } from '../geometry/selfcare-layout';
import { HallAmenity, HallCompass } from '../models/hall.model';
import { makeTextSprite } from './text-sprite';

// ---------------------------------------------------------------------------
//  Sizing constants
// ---------------------------------------------------------------------------

/**
 * Base side of an icon in metres, used as the initial sprite scale.
 *
 * This is the "natural" size the sprite is built at. The render-loop scaler
 * overrides this every frame to hold a constant *screen-pixel* size, clamped
 * between MIN_ICON_METRES and MAX_ICON_METRES. It is kept close to the old
 * value (was 4.5) so that the first frame before the scaler runs looks
 * reasonable and so that tests that read `sprite.scale` before a render pass
 * see a sensible default.
 */
const ICON_SIZE = 4.5;

/** Height above the floor. Above the zone fills (0.14) and below the marker text (1.6). */
const ICON_Y = 0.9;

// ---------------------------------------------------------------------------
//  Screen-space sizing — constants tuned per the brief
// ---------------------------------------------------------------------------

/**
 * Target size of an icon on screen, in CSS pixels.
 *
 * 52 px is large enough to recognise the glyph on a 133 m hall in frame
 * (~1100 px viewport) while still being discrete enough not to dominate a
 * 41 m hall. Tweak up for higher-DPI panels or down for denser plans.
 */
const TARGET_SCREEN_PX = 52;

/**
 * The icon sprite never shrinks below this many metres, even when zoomed in
 * very close. Prevents icons from becoming hard-to-hit pinpoints.
 */
const MIN_ICON_METRES = 3;

/**
 * The icon sprite never grows above this many metres, even when zoomed far
 * out. Prevents them from occluding stalls on very large halls.
 */
const MAX_ICON_METRES = 12;

/**
 * Camera distance below which captions are shown.
 *
 * Below this distance the user is "zoomed in enough" to read text. Above it
 * captions fade to invisible so the zoomed-out view shows only the clean
 * pictograms, eliminating the collision problem between neighbouring labels
 * without widening AMENITY_SPACING.
 */
const CAPTION_SHOW_DISTANCE = 70;

/**
 * Camera distance above which captions are fully hidden.
 * Between CAPTION_SHOW_DISTANCE and this value, opacity fades linearly.
 */
const CAPTION_HIDE_DISTANCE = 100;

// ---------------------------------------------------------------------------
//  Contrast / appearance
// ---------------------------------------------------------------------------

/** Tint of the placeholder square shown until the SVG loads, per kind. Matches the SelfCare chips. */
const PLACEHOLDER_COLOR: Record<string, string> = {
  'toilet-male': '#60a5fa',
  'toilet-female': '#f0abfc',
  stairs: '#fb923c',
  'entry-up': '#94a3b8'
};

/**
 * Width of the white halo ring drawn behind each icon chip, as a fraction of
 * ICON_TEXTURE_PX. This separates the coloured chip from the light floor and
 * the grey grid lines behind it, making the icon readable at every zoom.
 */
const HALO_WIDTH_FRACTION = 0.06;

/**
 * Drop-shadow offset and blur, as fractions of ICON_TEXTURE_PX, applied to
 * the canvas before the icon is drawn. This adds depth separation from the
 * floor plane.
 */
const SHADOW_OFFSET_FRACTION = 0.02;
const SHADOW_BLUR_FRACTION = 0.04;

// ---------------------------------------------------------------------------
//  User data keys — attached to sprites so the render-loop scaler can
//  distinguish icon sprites from caption sprites and read their base scale.
// ---------------------------------------------------------------------------

const UD_ICON = 'amenity-icon';
const UD_CAPTION = 'amenity-caption';
const UD_BASE_SCALE = 'amenity-base-scale';

// ---------------------------------------------------------------------------
//  Build API
// ---------------------------------------------------------------------------

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
      lineHeight: 1,
      bold: true
    });
    caption.position.set(amenity.position.x, ICON_Y, amenity.position.z + ICON_SIZE * 0.72);
    // Tag caption so the render-loop scaler can fade and scale it.
    caption.userData[UD_CAPTION] = true;
    caption.userData[UD_BASE_SCALE] = new THREE.Vector3().copy(caption.scale);
    group.add(caption);
  }

  return group;
}

/**
 * Layer 9b — the plan's north arrow, from the SelfCare `direction` field.
 *
 * SelfCare draws it outside the hall outline, so like the amenities it is pure decoration. The
 * rose is a sprite, which is camera-facing; `material.rotation` turns it in plane. SelfCare's
 * angle is measured clockwise on a 2D canvas and three's is counter-clockwise, hence the
 * negation.
 */
export function buildCompass(compass: HallCompass | null | undefined): THREE.Group {
  const group = new THREE.Group();
  group.name = 'compass';
  if (!compass || !Number.isFinite(compass.position?.x) || !Number.isFinite(compass.position?.z)) {
    return group;
  }

  const size = compass.size > 0 ? compass.size : 5;
  const material = new THREE.SpriteMaterial({
    map: placeholderTexture('#ffffff'),
    depthTest: false,
    transparent: true
  });
  material.rotation = (-compass.rotation * Math.PI) / 180;

  const rose = new THREE.Sprite(material);
  rose.scale.set(size, size, 1);
  rose.position.set(compass.position.x, ICON_Y, compass.position.z);
  rose.renderOrder = 29;
  group.add(rose);

  loadTexture(COMPASS_ICON_URL).then(texture => {
    if (!texture) return;
    if (!isAttachedToScene(rose)) {
      texture.dispose();
      return;
    }
    material.map?.dispose();
    material.map = texture;
    material.needsUpdate = true;
  });

  const label = makeTextSprite([compass.label], {
    color: '#0f172a',
    background: 'rgba(255,255,255,0.92)',
    lineHeight: 0.8,
    bold: true
  });
  label.position.set(
    compass.position.x + compass.labelOffset.x,
    ICON_Y,
    compass.position.z + compass.labelOffset.z
  );
  group.add(label);

  return group;
}

// ---------------------------------------------------------------------------
//  Render-loop scaler — called every frame from scene3d.component.ts
// ---------------------------------------------------------------------------

/**
 * Update the world-space scale of every amenity icon sprite so it holds a
 * roughly constant screen-pixel size, and fade captions in/out depending on
 * zoom distance.
 *
 * This is the core fix for "icons too small on large halls": a 4.5 m sprite
 * that is fine on a 41 m hall is invisible on a 260 m one. Scaling by camera
 * distance keeps the icon at ~TARGET_SCREEN_PX regardless of hall size, while
 * the min/max clamp prevents extremes.
 *
 * Call from the render loop, after controls.update() but before renderer.render().
 */
export function updateAmenityScales(
  amenityGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number
): void {
  if (amenityGroup.children.length === 0) return;

  // Camera distance from the floor plane. For our orbit camera the target
  // sits on y = 0 and the camera orbits above, so the Euclidean distance
  // from the camera to its ground-plane projection is camera.position.y
  // (the height). This is a better proxy than the full orbit radius for
  // the "how much world fits in a pixel" calculation, because the vertical
  // component of the view frustum maps to world-space Y (vertical), while
  // the horizontal / depth component maps to the floor (XZ). What we want
  // is the camera's height above the floor — as height grows, each pixel
  // covers more world-space metres.
  const distance = Math.abs(camera.position.y) || 1;

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const worldPerPx = (2 * distance * Math.tan(vFov / 2)) / Math.max(viewportHeight, 1);

  // Desired icon size in world-space metres, clamped.
  const desired = TARGET_SCREEN_PX * worldPerPx;
  const iconMetres = Math.min(MAX_ICON_METRES, Math.max(MIN_ICON_METRES, desired));

  // Caption opacity: 1 when close, 0 when far, linear ramp between thresholds.
  const captionOpacity =
    distance <= CAPTION_SHOW_DISTANCE
      ? 1
      : distance >= CAPTION_HIDE_DISTANCE
        ? 0
        : 1 - (distance - CAPTION_SHOW_DISTANCE) / (CAPTION_HIDE_DISTANCE - CAPTION_SHOW_DISTANCE);

  // Caption scale factor relative to its base (built) scale. Shrink slightly
  // at distance so the label doesn't compete with the icon.
  const captionScaleFactor = 0.6 + 0.4 * captionOpacity;

  amenityGroup.traverse(child => {
    if (!(child instanceof THREE.Sprite)) return;

    if (child.userData[UD_ICON]) {
      child.scale.set(iconMetres, iconMetres, 1);
    } else if (child.userData[UD_CAPTION]) {
      const base: THREE.Vector3 | undefined = child.userData[UD_BASE_SCALE];
      if (base) {
        child.scale.set(
          base.x * captionScaleFactor,
          base.y * captionScaleFactor,
          1
        );
      }
      child.material.opacity = captionOpacity;
      child.visible = captionOpacity > 0.01;
    }
  });
}

/** The compass rose asset SelfCare names in `direction.image.url`. */
const COMPASS_ICON_URL = 'assets/images/direction.svg';

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

  // Tag for the render-loop scaler.
  sprite.userData[UD_ICON] = true;

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
const ICON_TEXTURE_PX = 512;

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

/**
 * Load `url` and re-rasterise it into a square `ICON_TEXTURE_PX` canvas texture, with a white
 * halo ring and subtle drop shadow for contrast against the light floor and grid.
 */
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

      // --- Contrast enhancement: white halo + drop shadow ---

      // The icon chips are ~25×25 viewBox with a 5px corner radius rounded rect.
      // We draw a slightly larger white rounded rect behind the icon to create a
      // halo that separates the coloured chip from the floor and grid.
      const haloW = ICON_TEXTURE_PX * HALO_WIDTH_FRACTION;
      const shadowOff = ICON_TEXTURE_PX * SHADOW_OFFSET_FRACTION;
      const shadowBlur = ICON_TEXTURE_PX * SHADOW_BLUR_FRACTION;

      // Fit the icon inside a sub-region that leaves room for the halo.
      const source = Math.max(image.naturalWidth || 1, image.naturalHeight || 1);
      const margin = haloW * 2; // space for halo on each side
      const fitSize = ICON_TEXTURE_PX - margin * 2;
      const scale = fitSize / source;
      const w = (image.naturalWidth || source) * scale;
      const h = (image.naturalHeight || source) * scale;
      const ix = (ICON_TEXTURE_PX - w) / 2;
      const iy = (ICON_TEXTURE_PX - h) / 2;

      // Drop shadow behind the whole icon.
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowOffsetX = shadowOff;
      ctx.shadowOffsetY = shadowOff;
      ctx.shadowBlur = shadowBlur;

      // White halo: a rounded rect slightly larger than the icon.
      const hx = ix - haloW;
      const hy = iy - haloW;
      const hw = w + haloW * 2;
      const hh = h + haloW * 2;
      const hr = (hw / w) * ((source / 25) * 5) * scale; // proportional corner radius
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(hx + hr, hy);
      ctx.arcTo(hx + hw, hy, hx + hw, hy + hh, hr);
      ctx.arcTo(hx + hw, hy + hh, hx, hy + hh, hr);
      ctx.arcTo(hx, hy + hh, hx, hy, hr);
      ctx.arcTo(hx, hy, hx + hw, hy, hr);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // The icon itself, drawn over the halo.
      ctx.drawImage(image, ix, iy, w, h);

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
    // White halo behind the placeholder too, for consistency.
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, 2, 2, 60, 60, 14);
    ctx.fill();

    ctx.fillStyle = color;
    // arcTo rather than ctx.roundRect, for the same reason text-sprite.ts rolls its own.
    const x = 6;
    const y = 6;
    const size = 52;
    const r = 12;
    roundedRect(ctx, x, y, size, size, r);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Draw a rounded rect path (does not fill — caller does). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
