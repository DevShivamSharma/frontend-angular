import * as THREE from 'three';

import {
  CAPTION_FONT,
  cardLayout,
  CardLayout,
  PlanCard,
  planCards,
  COMPASS_LABEL_FONT,
  EXIT_LABEL_FONT,
  ICON_SIZE,
} from '../geometry/plan-annotations';
import { iconUrlFor } from '../geometry/selfcare-layout';
import { Rect } from '../geometry/placement-rules';
import { annotationRect, placeAnnotationCards } from '../geometry/annotation-placement';
import { floorOutlines, planSize } from '../geometry/hall-plan';
import { Hall, HallAmenity, HallCompass, HallMarker } from '../models/hall.model';

/**
 * The plan's annotations — icon cards (`helper_text`), gate / foyer captions (`exit_labels`) and
 * the north arrow (`direction`) — drawn the way SelfCare draws them: flat on the plan, at plan
 * scale, anchored by their top-left corner.
 *
 * The earlier renderer drew each icon as a camera-facing sprite resized every frame to a fixed
 * screen size (up to 12 m) and spread every row of icons 5 m apart around its anchor. That is why
 * icons collided, drifted off their walls and never matched the plan: SelfCare's positions are
 * top-left corners of plan-scale boxes, not centres of screen-scale chips.
 *
 * Each card / label is one canvas texture on a flat plane. Icons are the repository's own SVGs
 * (`assets/images/<kind>.svg`), rasterised into the card at the card's resolution.
 */

/** Texture pixels per metre. 64 keeps a 16 m card at 1024 px and text sharp when zoomed in. */
const PX_PER_M = 64;
/** Above the floor, the grid (0.13) and the plan's patches (0.16-0.17). */
const Y = 0.25;
const RENDER_ORDER = 25;
const TEXT_COLOR = '#1f2937';
const FONT_FAMILY = 'Inter, system-ui, sans-serif';

// --- icon cards -------------------------------------------------------------------------------

/**
 * Every icon, grouped into the cards SelfCare draws (see `planCards`): one row of icons on one
 * white card, shifted only when its source position would overlap the floor or another label.
 */
export function buildAmenityCards(hall: Hall): THREE.Group {
  const group = new THREE.Group();
  group.name = 'amenity-cards';

  for (const card of layoutAnnotations(hall).cards) group.add(buildCard(card));
  return group;
}

interface DisplayCard extends PlanCard<HallAmenity> {
  layout: CardLayout;
  width: number;
  height: number;
}

interface AnnotationLayout {
  cards: DisplayCard[];
  labels: Rect[];
}

const layoutCache = new WeakMap<Hall, AnnotationLayout>();

/** Drawing and camera framing use the same measured, collision-cleared rectangles. */
function layoutAnnotations(hall: Hall): AnnotationLayout {
  const cached = layoutCache.get(hall);
  if (cached) return cached;
  const cards = planCards(hall.amenities ?? []).map((card) => {
    const layout = cardLayout(
      card.items.map((item) => item.label),
      (text, font) => measure(text, `700 ${font * PX_PER_M}px ${FONT_FAMILY}`) / PX_PER_M,
    );
    return { ...card, layout, width: layout.width, height: layout.height };
  });
  const labels = fixedAnnotationRects(hall.markers ?? [], hall.compass);
  let floors = floorOutlines(hall);
  if (!floors.length) {
    const { width, length } = planSize(hall);
    floors = [hall.shape === 'CIRCLE'
      ? Array.from({ length: 64 }, (_, i) => ({
          x: Math.cos(i * Math.PI / 32) * width / 2,
          z: Math.sin(i * Math.PI / 32) * length / 2,
        }))
      : [{ x: -width / 2, z: -length / 2 }, { x: width / 2, z: -length / 2 },
         { x: width / 2, z: length / 2 }, { x: -width / 2, z: length / 2 }]];
  }
  const result = { cards: placeAnnotationCards(cards, floors, labels), labels };
  layoutCache.set(hall, result);
  return result;
}

function buildCard(card: DisplayCard): THREE.Mesh {
  const captions = card.items.map((i) => i.label.toUpperCase());
  const captionFont = `700 ${CAPTION_FONT * PX_PER_M}px ${FONT_FAMILY}`;
  const { layout, anchor } = card;

  const canvas = document.createElement('canvas');
  canvas.width = Math.min(4096, Math.ceil(layout.width * PX_PER_M));
  canvas.height = Math.ceil(layout.height * PX_PER_M);
  const scale = canvas.width / (layout.width * PX_PER_M);

  const draw = (images: Array<HTMLImageElement | null>): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, layout.width * PX_PER_M, layout.height * PX_PER_M);

    // The white card with the faint border SelfCare gives it.
    const r = 0.25 * PX_PER_M;
    roundRect(ctx, 1, 1, layout.width * PX_PER_M - 2, layout.height * PX_PER_M - 2, r);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e5e7eb';
    ctx.stroke();

    ctx.font = captionFont;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    layout.slots.forEach((slot, i) => {
      const size = ICON_SIZE * PX_PER_M;
      const cx = slot.iconX * PX_PER_M;
      const cy = slot.iconZ * PX_PER_M;
      const image = images[i];
      if (image) {
        const w = image.naturalWidth || 1;
        const h = image.naturalHeight || 1;
        const k = size / Math.max(w, h);
        ctx.drawImage(image, cx - (w * k) / 2, cy - (h * k) / 2, w * k, h * k);
      } else {
        ctx.fillStyle = '#e2e8f0';
        roundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.2);
        ctx.fill();
        ctx.fillStyle = TEXT_COLOR;
      }
      ctx.fillText(captions[i], cx, slot.captionTop * PX_PER_M);
    });
  };

  draw(card.items.map(() => null));
  const texture = canvasTexture(canvas);
  const mesh = flatPlane(texture, layout.width, layout.height);
  mesh.position.set(anchor.x + layout.width / 2, Y, anchor.z + layout.height / 2);
  mesh.name = 'amenity-card';
  mesh.userData['amenityKinds'] = card.items.map((i) => i.kind);

  Promise.all(card.items.map((i) => loadImage(iconUrlFor(i.kind)))).then((images) => {
    if (!isAttachedToScene(mesh)) return;
    draw(images);
    texture.needsUpdate = true;
  });

  return mesh;
}

// --- gate / foyer captions --------------------------------------------------------------------

/** `exit_labels` as plain text on the plan, top-left anchored like SelfCare's. */
export function buildExitLabels(markers: readonly HallMarker[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'exit-labels';
  for (const marker of markers) {
    const text = String(marker?.text ?? '').trim();
    if (!text || !Number.isFinite(marker.position?.x) || !Number.isFinite(marker.position?.z))
      continue;
    const label = flatText(text, EXIT_LABEL_FONT, '600');
    label.mesh.position.set(
      marker.position.x + label.width / 2,
      Y,
      marker.position.z + label.height / 2,
    );
    label.mesh.name = 'exit-label';
    label.mesh.userData['text'] = text;
    group.add(label.mesh);
  }
  return group;
}

// --- north arrow ------------------------------------------------------------------------------

/** The compass rose (`assets/images/direction.svg`) turned by its rotation, and its letter. */
export function buildCompass(compass: HallCompass | null | undefined): THREE.Group {
  const group = new THREE.Group();
  group.name = 'compass';
  if (!compass || !Number.isFinite(compass.position?.x) || !Number.isFinite(compass.position?.z))
    return group;

  const size = compass.size > 0 ? compass.size : 5;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const texture = canvasTexture(canvas);
  const rose = flatPlane(texture, size, size);
  rose.name = 'compass-rose';

  // SelfCare's rotation is clockwise on the plan (CSS). Seen from above with the plan's top away
  // from the viewer, clockwise is a negative turn about +Y.
  const pivot = new THREE.Group();
  pivot.position.set(compass.position.x, Y, compass.position.z);
  pivot.rotation.y = (-compass.rotation * Math.PI) / 180;
  pivot.add(rose);
  group.add(pivot);

  loadImage(COMPASS_ICON_URL).then((image) => {
    const ctx = canvas.getContext('2d');
    if (!image || !ctx || !isAttachedToScene(rose)) return;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;
  });

  const letter = flatText(compass.label || 'N', COMPASS_LABEL_FONT, '700');
  letter.mesh.name = 'compass-label';
  letter.mesh.position.set(
    compass.position.x + compass.labelOffset.x + letter.width / 2,
    Y,
    compass.position.z + compass.labelOffset.z + letter.height / 2,
  );
  group.add(letter.mesh);
  return group;
}

const COMPASS_ICON_URL = 'assets/images/direction.svg';

// --- extents ----------------------------------------------------------------------------------

/** Where the annotations reach, so the camera can frame them with the hall. */
export function annotationBounds(hall: Hall): Rect | null {
  const { cards, labels } = layoutAnnotations(hall);
  const rects = [...cards.map((card) => annotationRect(card)), ...labels];
  if (!rects.length) return null;
  return {
    minX: Math.min(...rects.map((r) => r.minX)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    minZ: Math.min(...rects.map((r) => r.minZ)),
    maxZ: Math.max(...rects.map((r) => r.maxZ)),
  };
}

function fixedAnnotationRects(
  markers: readonly HallMarker[],
  compass: HallCompass | null | undefined,
): Rect[] {
  const rects: Rect[] = [];
  for (const marker of markers) {
    const text = String(marker?.text ?? '').trim();
    if (!text || !Number.isFinite(marker.position?.x) || !Number.isFinite(marker.position?.z))
      continue;
    rects.push(annotationRect({ anchor: marker.position, ...textSize(text, EXIT_LABEL_FONT, '600') }));
  }
  if (compass && Number.isFinite(compass.position?.x) && Number.isFinite(compass.position?.z)) {
    const angle = compass.rotation * Math.PI / 180;
    const half = (compass.size > 0 ? compass.size : 5) / 2 *
      (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
    rects.push({
      minX: compass.position.x - half, maxX: compass.position.x + half,
      minZ: compass.position.z - half, maxZ: compass.position.z + half,
    });
    rects.push(annotationRect({
      anchor: {
        x: compass.position.x + compass.labelOffset.x,
        z: compass.position.z + compass.labelOffset.z,
      },
      ...textSize(compass.label || 'N', COMPASS_LABEL_FONT, '700'),
    }));
  }
  return rects;
}

// --- helpers ----------------------------------------------------------------------------------

function textSize(text: string, font: number, weight: string): { width: number; height: number } {
  const css = `${weight} ${font * PX_PER_M}px ${FONT_FAMILY}`;
  return {
    width: Math.ceil(measure(text, css) + 0.2 * PX_PER_M) / PX_PER_M,
    height: Math.ceil(font * 1.25 * PX_PER_M + 0.2 * PX_PER_M) / PX_PER_M,
  };
}

function flatText(
  text: string,
  font: number,
  weight: string,
): { mesh: THREE.Mesh; width: number; height: number } {
  const css = `${weight} ${font * PX_PER_M}px ${FONT_FAMILY}`;
  const pad = 0.1 * PX_PER_M;
  const canvas = document.createElement('canvas');
  const { width, height } = textSize(text, font, weight);
  canvas.width = width * PX_PER_M;
  canvas.height = height * PX_PER_M;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = css;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textBaseline = 'top';
    ctx.fillText(text, pad, pad);
  }
  return { mesh: flatPlane(canvasTexture(canvas), width, height), width, height };
}

function flatPlane(texture: THREE.Texture, width: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    // Drawn over everything, as on the plan: a 1.5 m wall must not hide half a card in perspective.
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = RENDER_ORDER;
  return mesh;
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function measure(text: string, font: string): number {
  if (measureContext === undefined)
    measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * parseFloat(font.split(' ')[1]) * 0.65;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/** One load per icon URL; a hall repeats the same few icons many times. */
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn(`Plan icon missing: ${url}`);
      resolve(null);
    };
    image.src = url;
  });
  imageCache.set(url, pending);
  return pending;
}

/** True while `object` still hangs off a `THREE.Scene`, i.e. its layer has not been disposed. */
function isAttachedToScene(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object.parent; node; node = node.parent) {
    if (node instanceof THREE.Scene) return true;
  }
  return false;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
