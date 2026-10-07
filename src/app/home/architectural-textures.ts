import * as T from 'three';

export type SurfaceTexture = 'stone' | 'metal' | 'copper' | 'render';
export interface SurfaceMaps { color: T.CanvasTexture; height: T.CanvasTexture; roughness: T.CanvasTexture; }

/** Shared, deterministic physical-scale maps. No remote image or per-frame work. */
export function createSurfaceMaps(kind: SurfaceTexture, channel = 0, anisotropy = 8): SurfaceMaps {
  const size = 512;
  const make = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const color = make(), height = make(), roughness = make();
  const c = color.getContext('2d')!, h = height.getContext('2d')!, r = roughness.getContext('2d')!;
  let seed = 14;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const image = c.createImageData(size, size), bump = h.createImageData(size, size), rough = r.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const joint = kind === 'stone' ? x % 128 < 2 || y % 256 < 2 :
      kind === 'metal' ? x % 64 < 2 : kind === 'copper' ? (x + Math.floor(y / 128) % 2 * 64) % 128 < 2 || y % 128 < 2 : false;
    const grain = random() * 9 - 4.5;
    const panel = kind === 'render' ? 0 : Math.sin(Math.floor(x / 128) * 11 + Math.floor(y / 256) * 3) * 3;
    const value = joint ? 140 : 236 + grain + panel;
    for (let k = 0; k < 3; k++) {
      image.data[i + k] = value;
      bump.data[i + k] = joint ? 82 : 130 + grain * .9;
      rough.data[i + k] = (kind === 'metal' || kind === 'copper' ? 158 : 215) + grain * 2;
    }
    image.data[i + 3] = bump.data[i + 3] = rough.data[i + 3] = 255;
  }
  c.putImageData(image, 0, 0); h.putImageData(bump, 0, 0); r.putImageData(rough, 0, 0);
  const texture = (canvas: HTMLCanvasElement, srgb = false) => {
    const t = new T.CanvasTexture(canvas); t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = anisotropy; t.channel = channel;
    return t;
  };
  return { color: texture(color, true), height: texture(height), roughness: texture(roughness) };
}
