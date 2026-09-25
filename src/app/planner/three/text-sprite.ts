import * as THREE from 'three';

export interface TextSpriteOptions {
  color?: string;
  background?: string;
  /** World height of one text line, in metres. */
  lineHeight?: number;
  bold?: boolean;
}

/**
 * A camera-facing text label that lives in the 3D scene (a sprite with a canvas texture).
 *
 * Used for labels that belong to scene geometry - the live draft size, zone names, gate
 * markers - so they move, scale and hide with the scene instead of being DOM overlays.
 * `disposeChildren()` frees the geometry and material; the texture is freed via `dispose()`
 * on the material's map, which `disposeTextSprite` does.
 */
export function makeTextSprite(lines: string[], options: TextSpriteOptions = {}): THREE.Sprite {
  const fontPx = 44;
  const padding = 18;
  const lineGap = 10;
  const font = `${options.bold ? '700' : '600'} ${fontPx}px Inter, system-ui, sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  const widths = lines.map(line => {
    if (!measure) return line.length * fontPx * 0.6;
    measure.font = font;
    return measure.measureText(line).width;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(Math.max(...widths, 1) + padding * 2);
  canvas.height = Math.ceil(lines.length * fontPx + (lines.length - 1) * lineGap + padding * 2);

  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (options.background) {
      ctx.fillStyle = options.background;
      roundRect(ctx, 0, 0, canvas.width, canvas.height, 14);
      ctx.fill();
    }
    ctx.font = font;
    ctx.fillStyle = options.color ?? '#0f172a';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, padding, padding + i * (fontPx + lineGap)));
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  );
  const lineHeight = options.lineHeight ?? 0.9;
  const worldHeight = (canvas.height / (fontPx + lineGap)) * lineHeight;
  sprite.scale.set((worldHeight * canvas.width) / canvas.height, worldHeight, 1);
  sprite.renderOrder = 30;
  return sprite;
}

/** Frees the canvas textures of every sprite below `root` (materials/geometry are separate). */
export function disposeSpriteTextures(root: THREE.Object3D): void {
  root.traverse(child => {
    if (child instanceof THREE.Sprite) child.material.map?.dispose();
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
