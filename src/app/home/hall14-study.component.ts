import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { detailHall14 } from './hall14-detail';
import { venueAsset } from './venue.models';

@Component({
  selector: 'app-hall14-study', standalone: true, imports: [RouterLink],
  templateUrl: './hall14-study.component.html', styleUrl: './hall14-study.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Hall14StudyComponent implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly ready = signal(false);
  readonly error = signal('');
  readonly progress = signal(0);
  readonly detailed = signal(true);
  readonly angle = signal<'exterior' | 'entrance' | 'roof'>('exterior');
  private renderer?: T.WebGLRenderer;
  private camera?: T.PerspectiveCamera;
  private controls?: OrbitControls;
  private scene?: T.Scene;
  private original?: T.Group;
  private enhanced?: T.Group;
  private environment?: T.WebGLRenderTarget;
  private observer?: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private readonly lifetime = new AbortController();

  ngAfterViewInit(): void { this.zone.runOutsideAngular(() => void this.initialize()); }

  private async initialize(): Promise<void> {
    try {
      const canvas = this.canvas().nativeElement;
      const renderer = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.AgXToneMapping; renderer.toneMappingExposure = 1.02;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      const scene = this.scene = new T.Scene(); scene.background = new T.Color('#e9e8e2');
      scene.fog = new T.Fog('#e9e8e2', 300, 650);
      const camera = this.camera = new T.PerspectiveCamera(38, 1, .2, 1200);
      const controls = this.controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true; controls.dampingFactor = .09;
      controls.minDistance = 14; controls.maxDistance = 340;
      controls.maxPolarAngle = Math.PI * .485;
      const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
      this.environment = pmrem.fromScene(room, .04);
      scene.environment = this.environment.texture; scene.environmentIntensity = .6;
      room.dispose(); pmrem.dispose();
      scene.add(new T.HemisphereLight('#e8f0ff', '#aaa090', .48));
      const sun = new T.DirectionalLight('#fff1d9', 4.2); sun.position.set(-110, 85, 35);
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 1, far: 300 });
      sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias = .06; sun.shadow.bias = -.00015;
      scene.add(sun);
      const fill = new T.DirectionalLight('#d5e5ed', .35); fill.position.set(70, 35, -55); scene.add(fill);
      const ground = new T.Mesh(new T.PlaneGeometry(10000, 10000), new T.MeshStandardMaterial({ color: '#c9c8bc', roughness: .96 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.03; ground.receiveShadow = true; scene.add(ground);
      const apron = new T.Mesh(new T.CylinderGeometry(1, 1, .06, 128), new T.MeshStandardMaterial({ color: '#d5d0c2', roughness: .9 }));
      apron.scale.set(50.5, 1, 57); apron.position.y = .015; apron.receiveShadow = true; scene.add(apron);
      const response = await fetch(venueAsset('hall14-study.glb'), { signal: this.lifetime.signal });
      if (!response.ok) throw new Error('The Hall 14 model could not load.');
      const data = await response.arrayBuffer();
      if (this.disposed) return;
      this.zone.run(() => this.progress.set(75));
      const gltf = await new GLTFLoader().parseAsync(data, '');
      if (this.disposed) { release(gltf.scene); return; }
      gltf.scene.updateMatrixWorld(true);
      const local = new T.Matrix4().makeRotationY(-Math.PI / 3).multiply(
        new T.Matrix4().makeTranslation(223.60107421875, 0, -4.908121585845947));
      const original = this.original = new T.Group(); original.name = 'Hall 14 source';
      gltf.scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        const mesh = new T.Mesh(object.geometry.clone().applyMatrix4(local.clone().multiply(object.matrixWorld)), object.material.clone());
        mesh.name = object.name; mesh.castShadow = mesh.receiveShadow = true;
        original.add(mesh);
      });
      release(gltf.scene);
      this.enhanced = detailHall14(original);
      scene.add(original, this.enhanced); original.visible = false;
      renderer.shadowMap.needsUpdate = true;
      this.observer = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix(); this.applyView(this.angle());
      });
      this.observer.observe(canvas);
      controls.addEventListener('change', this.invalidate);
      document.addEventListener('visibilitychange', this.invalidate, { signal: this.lifetime.signal });
      this.applyView('exterior');
      this.zone.run(() => { this.progress.set(100); this.ready.set(true); });
      this.invalidate();
    } catch (error) {
      if (!this.disposed) this.zone.run(() => this.error.set(error instanceof Error ? error.message : 'The 3D preview could not start.'));
    }
  }

  setDetailed(value: boolean): void {
    this.detailed.set(value);
    if (!this.original || !this.enhanced || !this.renderer) return;
    this.original.visible = !value; this.enhanced.visible = value;
    this.renderer.shadowMap.needsUpdate = true; this.invalidate();
  }
  setAngle(angle: 'exterior' | 'entrance' | 'roof'): void {
    this.angle.set(angle); this.zone.runOutsideAngular(() => this.applyView(angle));
  }
  private applyView(angle: 'exterior' | 'entrance' | 'roof'): void {
    if (!this.camera || !this.controls) return;
    const poses = {
      exterior: { eye: [-117, 64, 148], target: [0, 10, 0] },
      entrance: { eye: [-31, 12, 109], target: [-1, 10, 44] },
      roof: { eye: [-92, 129, 119], target: [0, 12, 0] }
    };
    const pose = poses[angle];
    this.controls.target.fromArray(pose.target); this.camera.position.fromArray(pose.eye);
    const fit = Math.max(1, 1.35 / this.camera.aspect);
    this.camera.position.sub(this.controls.target).multiplyScalar(fit).add(this.controls.target);
    this.controls.update(); this.invalidate();
  }
  private readonly invalidate = (): void => {
    if (this.disposed || this.frame || document.hidden) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.renderer || !this.camera || !this.scene) return;
      const moving = this.controls?.update();
      this.renderer.render(this.scene, this.camera);
      if (moving) this.invalidate();
    });
  };
  retry(): void { location.reload(); }
  ngOnDestroy(): void {
    this.disposed = true; this.lifetime.abort(); cancelAnimationFrame(this.frame);
    this.observer?.disconnect(); this.controls?.dispose();
    if (this.scene) release(this.scene);
    this.environment?.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss();
  }
}

function release(root: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>();
  root.traverse(object => {
    if (object instanceof T.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
    if (object instanceof T.DirectionalLight) object.shadow.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
    material.dispose();
  }
  textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose());
}
