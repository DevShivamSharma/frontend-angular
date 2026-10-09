import type { HallFloor } from '../../core/api/api.models';

type Label = HallFloor['labels'][number];
type IconGroup = HallFloor['iconGroups'][number];

/**
 * A hall's text labels and helper cards (toilets, stairs, exits…) drawn to canvases, so every
 * view of the floor shows them alike. Those saved without a size are sized from the hall.
 */
export function annotationBase(f: Pick<HallFloor, 'width' | 'depth'> | null | undefined): number {
  return Math.max(f?.width ?? 100, f?.depth ?? 100);
}

export function labelSize(f: HallFloor | null | undefined, l: Label) {
  const base = annotationBase(f);
  return { width: l.width ?? base * 0.14, height: l.height ?? base * 0.0175 };
}

export function iconGroupSize(f: HallFloor | null | undefined, g: IconGroup) {
  const base = annotationBase(f);
  return {
    width: g.width ?? base * 0.09 * g.icons.length,
    height: g.height ?? base * 0.045,
  };
}

/** A text label on a clear canvas. */
export function labelCanvas(text: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#173349';
  ctx.font = '58px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 50, 1000);
  return canvas;
}

/** A white card with each helper's icon and name side by side; null when it has none. */
export function facilityCardCanvas(g: IconGroup): HTMLCanvasElement | null {
  if (!g.icons.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 320 * g.icons.length;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d8dee5';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  g.icons.forEach((icon, i) => {
    const x = i * 320 + 160;
    facilityIcon(ctx, icon.kind, x, 54);
    ctx.fillStyle = '#142d40';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon.label.toUpperCase(), x, 120, 300);
  });
  return canvas;
}

function facilityIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number) {
  const colors: Record<string, string> = {
    'toilet-male': '#80adef',
    'toilet-female': '#ee71ec',
    toilet: '#80adef',
    stairs: '#ff9652',
    lift: '#ff9652',
    'emergency-exit': '#10c83d',
    'drinking-water': '#383b99',
    'entry-up': '#353535',
    'cargo-truck': '#ff9652',
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colors[kind] ?? '#53849d';
  ctx.beginPath();
  ctx.roundRect(-32, -32, 64, 64, 9);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  const line = (points: number[][]) => {
    ctx.beginPath();
    points.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.stroke();
  };
  if (kind === 'toilet') {
    ctx.font = 'bold 25px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WC', 0, 2);
  } else if (kind.startsWith('toilet')) {
    ctx.beginPath();
    ctx.arc(0, -16, 6, 0, Math.PI * 2);
    ctx.fill();
    if (kind === 'toilet-female') {
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-13, 13);
      ctx.lineTo(13, 13);
      ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(-7, -7, 14, 19);
    line([
      [-5, 9],
      [-5, 24],
    ]);
    line([
      [5, 9],
      [5, 24],
    ]);
    line([
      [-15, 3],
      [0, -7],
      [15, 3],
    ]);
  } else if (kind === 'stairs') {
    line([
      [-22, 20],
      [-10, 20],
      [-10, 7],
      [3, 7],
      [3, -6],
      [16, -6],
      [16, -20],
    ]);
    line([
      [-22, 2],
      [0, -20],
      [-12, -20],
    ]);
  } else if (kind === 'lift') {
    ctx.strokeRect(-24, -24, 48, 48);
    line([
      [-10, 17],
      [-10, -14],
      [-17, -6],
    ]);
    line([
      [-10, -14],
      [-3, -6],
    ]);
    line([
      [10, -17],
      [10, 14],
      [17, 6],
    ]);
    line([
      [10, 14],
      [3, 6],
    ]);
  } else if (kind === 'drinking-water') {
    line([
      [-16, -9],
      [-12, 20],
      [12, 20],
      [16, -9],
      [-16, -9],
    ]);
    line([
      [-10, 0],
      [10, 0],
    ]);
    line([
      [0, -13],
      [0, -24],
      [16, -24],
    ]);
  } else if (kind === 'emergency-exit') {
    ctx.strokeRect(-21, -21, 21, 43);
    line([
      [1, 0],
      [23, 0],
      [15, -8],
    ]);
    line([
      [23, 0],
      [15, 8],
    ]);
  } else if (kind === 'entry-up') {
    line([
      [0, 23],
      [0, -22],
      [-14, -8],
    ]);
    line([
      [0, -22],
      [14, -8],
    ]);
  } else {
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('i', 0, 2);
  }
  ctx.restore();
}
