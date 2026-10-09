import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import * as T from 'three';
import type { HallFloor } from '../../core/api/api.models';
import type {
  FloorGeometry,
  Grid,
  MultiPolygon,
  PlanPage,
  Point,
} from '../../core/venues/floor-plan.models';
export interface PlanLayer {
  id: string;
  geometry: MultiPolygon;
  color: string;
  label?: string;
  grid?: Grid | null;
  /** A foyer or circulation zone: named on the plan even beside the floor's own labels. */
  zone?: boolean;
}
export interface AnnotationMove {
  id: string;
  x: number;
  y: number;
}
@Component({
  selector: 'app-three-plan',
  standalone: true,
  template: `<div class="plan-frame">
      <div
        #host
        class="canvas"
        aria-label="Floor plan review. Scroll to zoom, drag to pan. Selected corners can be dragged."
      ></div>
      @if (legends.length) {
        <details class="plan-legends">
          <summary>Legends</summary>
          <ul aria-label="Plan legends">
            @for (l of legends; track $index) {
              <li>
                <span class="legend-swatch" [style.background]="l.color || '#ffffff'">{{
                  l.code || ''
                }}</span
                ><span>{{ l.label }}</span>
              </li>
            }
          </ul>
        </details>
      }
    </div>
    @if (floorInfo) {
      <ul class="accessible-annotations" aria-label="Plan helper text">
        @for (g of floorInfo.iconGroups; track $index) {
          @for (i of g.icons; track $index) {
            <li [attr.data-helper-kind]="i.kind">{{ i.label }}</li>
          }
        }
        @for (l of floorInfo.labels; track $index) {
          <li>{{ l.text }}</li>
        }
      </ul>
    }
    @if (error) {
      <p role="alert">{{ error }}</p>
    }`,
  styles: `
    :host {
      display: block;
      position: relative;
      min-height: var(--plan-canvas-min-height, 420px);
    }
    .canvas {
      width: 100%;
      height: var(--plan-canvas-height, 65vh);
      min-height: var(--plan-canvas-min-height, 420px);
      touch-action: none;
      border: 1px solid #bac5cd;
      border-radius: 8px;
      overflow: hidden;
      flex: 1;
      min-width: 0;
    }
    .plan-frame {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .plan-legends {
      flex: 0 0 auto;
      max-width: min(240px, 40%);
      background: white;
      border: 1px solid #bac5cd;
      border-radius: 8px;
      overflow: auto;
    }
    .plan-legends summary {
      cursor: pointer;
      padding: 12px 8px;
      font-weight: 600;
    }
    .plan-legends:not([open]) summary {
      writing-mode: vertical-rl;
    }
    .plan-legends ul {
      list-style: none;
      margin: 0;
      padding: 0 10px 12px;
    }
    .plan-legends li {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 7px 0;
      font-size: 12px;
    }
    .legend-swatch {
      width: 24px;
      height: 18px;
      flex: 0 0 24px;
      border: 1px solid #bac5cd;
      font-size: 9px;
    }
    .accessible-annotations {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      margin: 0;
      padding: 0;
    }
    p {
      position: absolute;
      top: 10px;
      background: white;
      padding: 16px;
    }
  `,
})
export class ThreePlanComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  @Input() page: PlanPage | null = null;
  @Input() floor: FloorGeometry | null = null;
  @Input() floorInfo: HallFloor | null = null;
  @Input() selected = '';
  @Input() sourceOpacity = 0.8;
  @Input() draw = false;
  @Input() draft: Point[] = [];
  @Input() extra: PlanLayer[] = [];
  @Input() editable = true;
  @Input() annotationsEditable = false;
  @Input() selectedAnnotation = '';
  @Output() selectShape = new EventEmitter<string>();
  @Output() point = new EventEmitter<Point>();
  @Output() geometryChange = new EventEmitter<{ id: string; geometry: MultiPolygon }>();
  @Output() annotationSelect = new EventEmitter<string>();
  @Output() annotationMove = new EventEmitter<AnnotationMove>();
  error = '';
  get legends(): { label: string; color?: string | null; code?: string }[] {
    return this.floorInfo?.legend.filter((l) => l.showInView !== false) ?? this.page?.legend ?? [];
  }
  private renderer?: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.OrthographicCamera();
  private observer?: ResizeObserver;
  private width = 100;
  private height = 100;
  private base = 100;
  private viewOrigin: Point = [0, 0];
  private imageKey = '';
  private previousFloor: FloorGeometry | null = null;
  private texture?: T.Texture;
  private generation = 0;
  private dead = false;
  private down: {
    x: number;
    y: number;
    world: Point;
    cx: number;
    cy: number;
    vertex?: { id: string; g: MultiPolygon; p: number; r: number; v: number };
    annotation?: { id: string; x: number; y: number };
  } | null = null;
  ngAfterViewInit() {
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setClearColor('#eef2f5');
      this.host.nativeElement.appendChild(this.renderer.domElement);
      this.camera.position.set(50, -50, 1000);
      this.camera.near = 0.1;
      this.camera.far = 2000;
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.host.nativeElement);
      const el = this.renderer.domElement;
      el.addEventListener('wheel', this.wheel, { passive: false });
      el.addEventListener('pointerdown', this.pointerDown);
      el.addEventListener('pointermove', this.pointerMove);
      el.addEventListener('pointerup', this.pointerUp);
      el.addEventListener('pointercancel', this.pointerCancel);
      this.rebuild();
      this.fit();
    } catch {
      this.error =
        'WebGL could not start. Enable hardware acceleration or use a WebGL-capable browser to review this plan.';
    }
  }
  ngOnChanges() {
    if (this.renderer) this.rebuild();
  }
  private layers(): PlanLayer[] {
    if (this.floor)
      return [
        { id: 'hall', geometry: this.floor.hallBoundary, color: '#66b681', grid: this.floor.grid },
        ...this.floor.zones.map((z) => ({
          id: z.id,
          geometry: z.geometry,
          color: '#4aa9db',
          label: z.name,
          grid: z.grid ?? this.floor!.grid,
          zone: true,
        })),
        ...this.floor.objects.map((o) => ({
          id: o.id,
          geometry: o.geometry,
          color: o.color,
          label: o.label,
        })),
      ];
    return [
      ...(this.page?.regions
        .filter((r) => r.role !== 'exclude')
        .map((r) => ({
          id: r.id,
          geometry: r.geometry,
          label: r.name,
          color: r.role === 'hall' ? '#43a86e' : '#40a5cf',
          grid: r.grid ?? this.page?.grid,
        })) ?? []),
      ...(this.page?.objects.map((o) => ({
        id: o.id,
        geometry: o.geometry,
        label: o.label,
        color: o.kind === 'unknown' ? '#ffab26' : o.color,
      })) ?? []),
    ];
  }
  fit() {
    if (!this.renderer) return;
    this.base = Math.max(this.width, this.height);
    this.camera.position.set(
      this.viewOrigin[0] + this.width / 2,
      -(this.viewOrigin[1] + this.height / 2),
      1000,
    );
    this.camera.zoom = 1;
    this.resize();
  }
  zoom(factor: number) {
    this.camera.zoom = Math.max(0.15, Math.min(200, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
    this.render();
  }
  private resize() {
    if (!this.renderer) return;
    const el = this.host.nativeElement,
      w = el.clientWidth,
      h = el.clientHeight,
      aspect = w / h;
    this.renderer.setSize(w, h);
    const half = Math.max(this.height, this.width / aspect) * 0.54;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  private clear() {
    for (const c of [...this.scene.children]) {
      this.scene.remove(c);
      c.traverse((o) => {
        const mesh = o as T.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats)
          if (m) {
            const map = (m as T.MeshBasicMaterial).map;
            if (map && map !== this.texture) map.dispose();
            m.dispose();
          }
      });
    }
  }
  private rebuild() {
    const previous = this.imageKey;
    const changedFloor = this.floor !== this.previousFloor;
    this.previousFloor = this.floor;
    const extent = this.extent();
    this.width = this.page?.width ?? extent[0];
    this.height = this.page?.height ?? extent[1];
    if (this.page) this.viewOrigin = [0, 0];
    this.base = Math.max(this.width, this.height);
    this.clear();
    const key = this.page?.preview ?? '';
    this.imageKey = key;
    if (key !== previous) {
      this.texture?.dispose();
      this.texture = undefined;
      const version = ++this.generation;
      if (key)
        new T.TextureLoader().load(key, (t) => {
          if (this.dead || version !== this.generation) {
            t.dispose();
            return;
          }
          t.colorSpace = T.SRGBColorSpace;
          this.texture = t;
          this.rebuild();
        });
    }
    if (this.texture && key) {
      const plane = new T.Mesh(
        new T.PlaneGeometry(this.width, this.height),
        new T.MeshBasicMaterial({
          map: this.texture,
          transparent: true,
          opacity: this.sourceOpacity,
          depthTest: false,
        }),
      );
      plane.position.set(this.width / 2, -this.height / 2, -1);
      plane.renderOrder = 0;
      this.scene.add(plane);
    }
    for (const [i, l] of [...this.layers(), ...this.extra].entries()) {
      this.polygon(l, i + 1);
      if (l.grid) this.grid(l);
      if (l.label && (!this.floorInfo || l.zone)) this.label(l);
    }
    this.drawAnnotations();
    if (this.annotationsEditable && this.selectedAnnotation) {
      const a = this.annotationBoxes().find((a) => a.id === this.selectedAnnotation);
      if (a)
        this.line(
          [
            [a.x, a.y],
            [a.x + a.width, a.y],
            [a.x + a.width, a.y + a.height],
            [a.x, a.y + a.height],
            [a.x, a.y],
          ],
          '#146bc4',
          110,
        );
    }
    if (this.selected && this.editable) {
      const l = this.layers().find((l) => l.id === this.selected);
      if (l) {
        const coords = l.geometry.flat(2).flatMap((p) => [p[0], -p[1], 5]);
        const geom = new T.BufferGeometry();
        geom.setAttribute('position', new T.Float32BufferAttribute(coords, 3));
        const dots = new T.Points(
          geom,
          new T.PointsMaterial({
            color: '#0d2035',
            size: 7,
            sizeAttenuation: false,
            depthTest: false,
          }),
        );
        dots.renderOrder = 100;
        this.scene.add(dots);
      }
    }
    if (this.draft.length) this.line(this.draft, '#e44727', 101);
    this.render();
    if (previous !== key || changedFloor) this.fit();
  }
  private annotationPoints(): Point[] {
    const f = this.floorInfo;
    if (!f) return [];
    return [
      ...f.labels.flatMap(
        (l) =>
          [
            [l.x, l.y],
            [
              l.x + (l.width ?? this.annotationBase * 0.14),
              l.y + (l.height ?? this.annotationBase * 0.0175),
            ],
          ] as Point[],
      ),
      ...f.iconGroups.flatMap(
        (g) =>
          [
            [g.x, g.y],
            [
              g.x + (g.width ?? this.annotationBase * 0.09 * g.icons.length),
              g.y + (g.height ?? this.annotationBase * 0.045),
            ],
          ] as Point[],
      ),
      ...(f.north
        ? ([
            [f.north.x, f.north.y],
            [f.north.x + f.north.size, f.north.y + f.north.size],
          ] as Point[])
        : []),
    ];
  }
  private get annotationBase() {
    return Math.max(this.floorInfo?.width ?? 100, this.floorInfo?.depth ?? 100);
  }
  private annotationBoxes() {
    const f = this.floorInfo;
    if (!f) return [];
    return [
      ...f.labels.map((l, index) => ({
        id: `label:${index}`,
        x: l.x,
        y: l.y,
        width: l.width ?? this.annotationBase * 0.14,
        height: l.height ?? this.annotationBase * 0.0175,
      })),
      ...f.iconGroups.map((g, index) => ({
        id: `icon:${index}`,
        x: g.x,
        y: g.y,
        width: g.width ?? this.annotationBase * 0.09 * g.icons.length,
        height: g.height ?? this.annotationBase * 0.045,
      })),
    ];
  }
  private extent(): Point {
    const points = [
      ...(this.floor?.boundary.flat(2) ?? ([[100, 100]] as Point[])),
      ...this.annotationPoints(),
    ];
    const x = Math.min(0, ...points.map((p) => p[0])),
      y = Math.min(0, ...points.map((p) => p[1]));
    this.viewOrigin = [x, y];
    return [Math.max(...points.map((p) => p[0])) - x, Math.max(...points.map((p) => p[1])) - y];
  }
  private drawAnnotations() {
    const f = this.floorInfo;
    if (!f) return;
    const label = (text: string, x: number, y: number) =>
      this.label({ id: 'annotation', geometry: [[[[x, y]]]], color: '#173349', label: text });
    for (const l of f.labels) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 100;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#173349';
      ctx.font = '58px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, 512, 50, 1000);
      this.annotationSprite(
        canvas,
        l.x,
        l.y,
        l.width ?? this.annotationBase * 0.14,
        l.height ?? this.annotationBase * 0.0175,
      );
    }
    for (const g of f.iconGroups) this.facilityCard(g);
    if (f.north) {
      const n = f.north,
        a = (n.rotation * Math.PI) / 180,
        s = n.size;
      const point = (x: number, y: number): Point => [
        n.x + s / 2 + x * Math.cos(a) - y * Math.sin(a),
        n.y + s / 2 + x * Math.sin(a) + y * Math.cos(a),
      ];
      this.line([point(0, s / 2), point(0, -s / 2)], '#173349', 91);
      this.line([point(-s / 4, -s / 5), point(0, -s / 2), point(s / 4, -s / 5)], '#173349', 91);
      const p = point(0, -s * 0.7);
      label(n.label || 'N', p[0], p[1]);
    }
  }
  private annotationSprite(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false }));
    sprite.position.set(x + width / 2, -(y + height / 2), 9);
    sprite.scale.set(width, height, 1);
    sprite.renderOrder = 95;
    this.scene.add(sprite);
  }
  private facilityCard(g: HallFloor['iconGroups'][number]) {
    if (!g.icons.length) return;
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
      this.facilityIcon(ctx, icon.kind, x, 54);
      ctx.fillStyle = '#142d40';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon.label.toUpperCase(), x, 120, 300);
    });
    this.annotationSprite(
      canvas,
      g.x,
      g.y,
      g.width ?? this.annotationBase * 0.09 * g.icons.length,
      g.height ?? this.annotationBase * 0.045,
    );
  }
  private facilityIcon(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number) {
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
  private polygon(layer: PlanLayer, order: number) {
    for (const poly of layer.geometry) {
      const shape = new T.Shape(poly[0].map((p) => new T.Vector2(p[0], -p[1])));
      for (const ring of poly.slice(1))
        shape.holes.push(new T.Path(ring.map((p) => new T.Vector2(p[0], -p[1]))));
      const mesh = new T.Mesh(
        new T.ShapeGeometry(shape),
        new T.MeshBasicMaterial({
          color: layer.color,
          transparent: true,
          opacity: this.page?.preview ? 0.25 : 0.55,
          side: T.DoubleSide,
          depthTest: false,
        }),
      );
      mesh.renderOrder = order;
      this.scene.add(mesh);
      for (const r of poly)
        this.line(r, layer.id === this.selected ? '#092440' : layer.color, order + 1);
    }
  }
  private label(layer: PlanLayer) {
    const points = layer.geometry.flat(2);
    if (!points.length) return;
    const x = points.reduce((s, p) => s + p[0], 0) / points.length,
      y = points.reduce((s, p) => s + p[1], 0) / points.length;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.fillRect(0, 0, 512, 64);
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#173349';
    ctx.fillText(layer.label!.slice(0, 40), 256, 32, 496);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.position.set(x, -y, 8);
    sprite.scale.set(this.base * 0.14, this.base * 0.0175, 1);
    sprite.renderOrder = 90;
    this.scene.add(sprite);
  }
  private line(points: Point[], color: string, order: number) {
    const g = new T.BufferGeometry().setFromPoints(
      points.map((p) => new T.Vector3(p[0], -p[1], 2)),
    );
    const line = new T.Line(g, new T.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = order;
    this.scene.add(line);
  }
  private grid(layer: PlanLayer) {
    const grid = layer.grid!;
    if (!(grid.width > 0 && grid.height > 0)) return;
    const angle = (grid.rotation * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const local = (p: Point): Point => [
      (p[0] - grid.x) * c + (p[1] - grid.y) * s,
      -(p[0] - grid.x) * s + (p[1] - grid.y) * c,
    ];
    const world = (p: Point): Point => [grid.x + p[0] * c - p[1] * s, grid.y + p[0] * s + p[1] * c];
    const rings = layer.geometry.flat().map((r) => r.map(local)),
      pts = rings.flat();
    const positions: number[] = [];
    for (const axis of [0, 1]) {
      const step = axis === 0 ? grid.width : grid.height,
        min = Math.min(...pts.map((p) => p[axis])),
        max = Math.max(...pts.map((p) => p[axis]));
      let from = Math.ceil(min / step),
        to = Math.floor(max / step);
      const stride = Math.max(1, Math.ceil((to - from) / 1200));
      for (let i = from; i <= to; i += stride) {
        const value = i * step,
          hits: number[] = [];
        for (const r of rings)
          for (let j = 1; j < r.length; j++) {
            const a = r[j - 1],
              b = r[j];
            if ((a[axis] <= value && b[axis] > value) || (b[axis] <= value && a[axis] > value))
              hits.push(
                a[1 - axis] +
                  ((value - a[axis]) / (b[axis] - a[axis])) * (b[1 - axis] - a[1 - axis]),
              );
          }
        hits.sort((a, b) => a - b);
        for (let j = 1; j < hits.length; j += 2) {
          const a = world(axis === 0 ? [value, hits[j - 1]] : [hits[j - 1], value]),
            b = world(axis === 0 ? [value, hits[j]] : [hits[j], value]);
          positions.push(a[0], -a[1], 1, b[0], -b[1], 1);
        }
      }
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    const lines = new T.LineSegments(
      geom,
      new T.LineBasicMaterial({
        color: '#60756a',
        transparent: true,
        opacity: 0.55,
        depthTest: false,
      }),
    );
    lines.renderOrder = 50;
    this.scene.add(lines);
  }
  private render() {
    if (this.renderer) this.renderer.render(this.scene, this.camera);
  }
  private world(e: PointerEvent | WheelEvent): Point {
    const r = this.renderer!.domElement.getBoundingClientRect(),
      v = new T.Vector3(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
        0,
      ).unproject(this.camera);
    return [v.x, -v.y];
  }
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const before = this.world(e);
    this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    const after = this.world(e);
    this.camera.position.x += before[0] - after[0];
    this.camera.position.y -= before[1] - after[1];
    this.render();
  };
  private pointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const world = this.world(e);
    this.down = {
      x: e.clientX,
      y: e.clientY,
      world,
      cx: this.camera.position.x,
      cy: this.camera.position.y,
    };
    this.renderer!.domElement.setPointerCapture(e.pointerId);
    if (e.button === 0 && !this.draw && this.annotationsEditable) {
      const a = this.annotationBoxes()
        .reverse()
        .find(
          (a) =>
            world[0] >= a.x &&
            world[0] <= a.x + a.width &&
            world[1] >= a.y &&
            world[1] <= a.y + a.height,
        );
      if (a) {
        this.down.annotation = { id: a.id, x: a.x, y: a.y };
        this.annotationSelect.emit(a.id);
        return;
      }
    }
    if (!this.draw && this.editable) {
      const l = this.layers().find((l) => l.id === this.selected);
      const tolerance =
        ((this.camera.right - this.camera.left) /
          this.camera.zoom /
          this.host.nativeElement.clientWidth) *
        10;
      if (l)
        l.geometry.forEach((p, pi) =>
          p.forEach((r, ri) =>
            r.slice(0, -1).forEach((v, vi) => {
              if (Math.hypot(v[0] - world[0], v[1] - world[1]) < tolerance)
                this.down!.vertex = {
                  id: l.id,
                  g: structuredClone(l.geometry),
                  p: pi,
                  r: ri,
                  v: vi,
                };
            }),
          ),
        );
    }
  };
  private pointerMove = (e: PointerEvent) => {
    if (!this.down) return;
    const p = this.world(e);
    if (this.down.annotation) {
      const a = this.down.annotation;
      this.annotationMove.emit({
        id: a.id,
        x: a.x + p[0] - this.down.world[0],
        y: a.y + p[1] - this.down.world[1],
      });
    } else if (this.down.vertex) {
      const v = this.down.vertex,
        r = v.g[v.p][v.r];
      r[v.v] = p;
      if (v.v === 0) r[r.length - 1] = p;
      this.geometryChange.emit({ id: v.id, geometry: structuredClone(v.g) });
    } else if (!this.draw) {
      this.camera.position.x += this.down.world[0] - p[0];
      this.camera.position.y -= this.down.world[1] - p[1];
      this.render();
    }
  };
  private pointerUp = (e: PointerEvent) => {
    if (!this.down) return;
    const click = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5;
    if (click && !this.down.vertex && !this.down.annotation) {
      const p = this.world(e);
      if (this.draw) this.point.emit(p);
      else {
        const found = [...this.layers()].reverse().find((l) => this.inside(p, l.geometry));
        if (found) this.selectShape.emit(found.id);
      }
    }
    this.down = null;
  };
  private pointerCancel = () => {
    this.down = null;
  };
  private inside(p: Point, g: MultiPolygon) {
    const inRing = (r: Point[]) => {
      let yes = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i],
          b = r[j];
        if (
          a[1] > p[1] !== b[1] > p[1] &&
          p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
        )
          yes = !yes;
      }
      return yes;
    };
    return g.some((poly) => inRing(poly[0]) && !poly.slice(1).some(inRing));
  }
  ngOnDestroy() {
    this.dead = true;
    this.observer?.disconnect();
    this.texture?.dispose();
    this.clear();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
