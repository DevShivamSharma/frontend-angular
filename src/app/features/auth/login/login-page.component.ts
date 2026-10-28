import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { AuthService } from '../../../core/auth/auth.service';
import { ApiError } from '../../../core/http/api-error';
import { FormFieldComponent } from '../../../shared/forms/form-field/form-field.component';
import { applyServerErrors } from '../../../shared/utils/form.util';

/** The only way in: email and password. There is no sign-up and no password reset here. */
@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    FormFieldComponent,
  ],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Where to go after signing in: the page the visitor was sent away from (route query parameter). */
  readonly returnUrl = input<string>();

  protected readonly submitting = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** Caps Lock is on while the password is typed: a likely wrong password, said before it is sent. */
  protected readonly capsLock = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  private readonly scene = viewChild.required<ElementRef<HTMLCanvasElement>>('scene');

  constructor() {
    afterNextRender(() => {
      const stop = drawHallScene(this.scene().nativeElement);
      this.destroyRef.onDestroy(stop);
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.failure.set(null);

    this.auth
      .login(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigateByUrl(this.safeReturnUrl()),
        error: (error: unknown) => {
          this.submitting.set(false);
          if (error instanceof ApiError && applyServerErrors(this.form, error)) {
            return;
          }
          this.failure.set(
            error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
          );
        },
      });
  }

  protected checkCapsLock(event: KeyboardEvent): void {
    this.capsLock.set(event.getModifierState?.('CapsLock') ?? false);
  }

  /** Only a path inside this app: never an address someone else put in the link. */
  private safeReturnUrl(): string {
    const url = this.returnUrl();
    return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
  }
}

/** A stall on the floor: depth and side of the camera in metres, its size, and red (an accent). */
const BLOCKS = [
  { d: 14, l: -9, w: 2, dp: 2, h: 1.4 },
  { d: 18, l: -13, w: 3, dp: 2, h: 2.4 },
  { d: 12, l: -13, w: 1, dp: 1, h: 0.9, a: true },
  { d: 24, l: -17, w: 2, dp: 3, h: 1.6 },
  { d: 22, l: -9, w: 2, dp: 2, h: 4.0 },
  { d: 30, l: -24, w: 3, dp: 2, h: 1.2 },
  { d: 14, l: 9, w: 2, dp: 3, h: 2.0 },
  { d: 19, l: 14, w: 3, dp: 3, h: 1.2 },
  { d: 12, l: 13, w: 1, dp: 1, h: 2.2, a: true },
  { d: 25, l: 19, w: 2, dp: 2, h: 3.2 },
  { d: 23, l: 9, w: 3, dp: 2, h: 0.8 },
  { d: 32, l: 26, w: 2, dp: 2, h: 2.0, a: true },
];
const FACES = ['#ffffff', '#f4ecdd', '#ebdfc9'];
const ACCENT = ['#e4003a', '#b8002f', '#cc0034'];

/**
 * The login design's background: a 1 m floor grid fading into the distance, with stalls standing
 * on it, and the camera swinging slowly (still when the person asks for less motion). Returns
 * the function that stops it.
 */
function drawHallScene(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  // A phone: the card fills the screen, so the scene would cost battery for little.
  if (!ctx || matchMedia('(max-width: 40rem)').matches) return () => undefined;
  const D2R = Math.PI / 180;
  const cam = { h: 6, pitch: 13, baseYaw: 28, swing: 8, f: 0.9, cy: 0.6, k: 11, e: 1.6 };
  const near = 0.15;
  const buckets = 12;
  const by = cam.baseYaw * D2R;
  const boxes = BLOCKS.map((b) => {
    const x = Math.round(b.l * Math.cos(by) + b.d * Math.sin(by));
    const z = Math.round(-b.l * Math.sin(by) + b.d * Math.cos(by));
    return { x0: x, z0: z, x1: x + b.w, z1: z + b.dp, h: b.h, a: !!b.a };
  });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0,
    h = 0,
    cy = 1,
    sy = 0,
    cp = 1,
    sp = 0,
    f = 1,
    centreY = 0,
    centreX = 0;
  let raf = 0;

  const resize = (): void => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width;
    h = r.height;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const toCamera = (x: number, y: number, z: number): number[] => {
    const yr = y - cam.h;
    const xc = x * cy - z * sy;
    const zc = x * sy + z * cy;
    return [xc, yr * cp + zc * sp, -yr * sp + zc * cp];
  };
  const project = (p: number[]): [number, number] => [
    centreX + (f * p[0]) / p[2],
    centreY - (f * p[1]) / p[2],
  ];
  const fade = (z: number): number => Math.max(0, Math.min(1, Math.pow(cam.k / z, cam.e)));

  const drawGrid = (): void => {
    const paths = Array.from({ length: buckets }, () => new Path2D());
    const reach = 70;
    const segment = (a: number[], b: number[]): void => {
      let p = toCamera(a[0], 0, a[1]);
      let q = toCamera(b[0], 0, b[1]);
      if (p[2] < near && q[2] < near) return;
      if (p[2] < near) {
        const t = (near - p[2]) / (q[2] - p[2]);
        p = p.map((v, i) => v + (q[i] - v) * t);
      }
      if (q[2] < near) {
        const t = (near - q[2]) / (p[2] - q[2]);
        q = q.map((v, i) => v + (p[i] - v) * t);
      }
      const alpha = fade((p[2] + q[2]) / 2);
      if (alpha < 0.06) return;
      const path = paths[Math.min(buckets - 1, Math.floor(alpha * buckets))];
      const [px, py] = project(p);
      const [qx, qy] = project(q);
      path.moveTo(px, py);
      path.lineTo(qx, qy);
    };
    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j < reach; j++) {
        segment([i, j], [i, j + 1]);
        segment([j, i], [j + 1, i]);
      }
    }
    ctx.lineWidth = 1;
    paths.forEach((path, b) => {
      ctx.strokeStyle = `rgba(140,100,50,${((0.38 * (b + 0.5)) / buckets).toFixed(3)})`;
      ctx.stroke(path);
    });
  };

  const drawBlocks = (): void => {
    const faces: { s: [number, number][]; z: number; fill: string }[] = [];
    const eye = [0, cam.h, 0];
    for (const b of boxes) {
      const fill = b.a ? ACCENT : FACES;
      const quads = [
        {
          pts: [
            [b.x0, b.h, b.z0],
            [b.x1, b.h, b.z0],
            [b.x1, b.h, b.z1],
            [b.x0, b.h, b.z1],
          ],
          n: [0, 1, 0],
          fill: fill[0],
        },
        {
          pts: [
            [b.x0, 0, b.z0],
            [b.x1, 0, b.z0],
            [b.x1, b.h, b.z0],
            [b.x0, b.h, b.z0],
          ],
          n: [0, 0, -1],
          fill: fill[1],
        },
        {
          pts: [
            [b.x0, 0, b.z1],
            [b.x1, 0, b.z1],
            [b.x1, b.h, b.z1],
            [b.x0, b.h, b.z1],
          ],
          n: [0, 0, 1],
          fill: fill[1],
        },
        {
          pts: [
            [b.x0, 0, b.z0],
            [b.x0, 0, b.z1],
            [b.x0, b.h, b.z1],
            [b.x0, b.h, b.z0],
          ],
          n: [-1, 0, 0],
          fill: fill[2],
        },
        {
          pts: [
            [b.x1, 0, b.z0],
            [b.x1, 0, b.z1],
            [b.x1, b.h, b.z1],
            [b.x1, b.h, b.z0],
          ],
          n: [1, 0, 0],
          fill: fill[2],
        },
      ];
      for (const q of quads) {
        const c = q.pts.reduce(
          (s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4],
          [0, 0, 0],
        );
        // Only the faces that look towards the camera.
        if (q.n[0] * (eye[0] - c[0]) + q.n[1] * (eye[1] - c[1]) + q.n[2] * (eye[2] - c[2]) <= 0)
          continue;
        const pts = q.pts.map((p) => toCamera(p[0], p[1], p[2]));
        if (pts.some((p) => p[2] < near)) continue;
        faces.push({ s: pts.map(project), z: toCamera(c[0], c[1], c[2])[2], fill: q.fill });
      }
    }
    faces.sort((a, b) => b.z - a.z);
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(110,80,40,0.55)';
    for (const face of faces) {
      ctx.beginPath();
      face.s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = face.fill;
      ctx.fill();
      ctx.stroke();
    }
  };

  const frame = (t: number): void => {
    const yaw = (cam.baseYaw + (still ? 0 : Math.sin(t / 9000) * cam.swing)) * D2R;
    const pitch = cam.pitch * D2R;
    cy = Math.cos(yaw);
    sy = Math.sin(yaw);
    cp = Math.cos(pitch);
    sp = Math.sin(pitch);
    f = h * cam.f;
    centreY = h * cam.cy;
    centreX = w / 2;
    ctx.clearRect(0, 0, w, h);
    drawGrid();
    drawBlocks();
    if (!still) raf = requestAnimationFrame(frame);
  };

  resize();
  const observer = new ResizeObserver(() => {
    resize();
    if (still) frame(0);
  });
  observer.observe(canvas);
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
  };
}
