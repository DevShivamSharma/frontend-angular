import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Served from `src/assets` (see the assets entry in angular.json). */
const MODEL_URL = 'assets/IITF_2026_Layout.glb';

/**
 * Detailed buildings loaded on top of the venue model, each replacing one of its simple nodes. They are
 * authored in the venue model's own coordinates, so they land exactly where the node they replace was.
 * - ITPO_OFFICE: blender-prototype/generate-itpo-office.py (modelled from a photo, baked)
 * - ITPO_H14:   blender-prototype/import-hall14.py (supplied GLB, decimated and fitted to the old footprint)
 * - CC_DETAILED: blender-prototype/import-meshy-area.mjs cc-hall14 (Meshy AI GLB of the Convention Centre,
 *   Hall 14 and the ground between them; fitted, clipped to the old CC / Hall 14 area, decimated).
 * - ITPO_H1: blender-prototype/import-meshy-area.mjs halls-1-5 (Meshy AI GLB of Hall 1 and the Halls 2-5
 *   complex with the gardens beside them; same pipeline).
 * A Meshy GLB's ground covers more than one node, so `alsoHides` lists the rest: the other buildings it
 * replaces and the old grounds it lies over (the `hide` list in the script's report).
 */
const DETAILED_BUILDINGS: { url: string; replaces: string; alsoHides?: string[] }[] = [
  { url: 'assets/buildings/ITPO_OFFICE.glb', replaces: 'ITPO_OFFICE' },
  { url: 'assets/buildings/HALL_14.glb', replaces: 'ITPO_H14' },
  {
    url: 'assets/buildings/CC_HALL_14.glb',
    replaces: 'CC_DETAILED',
    alsoHides: [
      'HALL_14_DETAILED',
      'CC_GROUND_DECK',
      'CC_GROUND_FOUNTAINS',
      'CC_GROUND_LAMPS',
      'CC_GROUND_PAVING',
      'CC_GROUND_PLANTING',
      'CC_GROUND_SCULPTURE',
      'CC_GROUND_TERRACES',
      'CC_GROUND_TREES',
      'CC_GROUND_WATER',
      'STRUCTURE_02_DETAIL',
      'STRUCTURE_03_DETAIL',
      'STRUCTURE_05'
    ]
  },
  {
    url: 'assets/buildings/HALLS_1_5.glb',
    replaces: 'ITPO_H1',
    alsoHides: [
      'HALL_2',
      'HALL_2_DETAIL',
      'HALL_3',
      'HALL_3_DETAIL',
      'HALL_4',
      'HALL_4_DETAIL',
      'HALL_5',
      'HALL_5_DETAIL',
      'GLASSBOX_HALL_2',
      'GLASSBOX_HALL_3',
      'GLASSBOX_HALL_4',
      'FOYER_ANNEX_HALLS_1-5',
      'AMPHITHEATRE_1',
      'AMPHITHEATRE_2'
    ]
  }
];

/**
 * Plain asphalt left on the site - SITE_GROUND with nothing on top - is covered with paving and lawn tiles
 * cut from the CC / Hall 14 GLB's own ground (blender-prototype/make-ground-tiles.mjs). See addGroundTiles().
 */
const SITE_GROUND_NAME = 'SITE_GROUND';
const GROUND_TILE_MAPS = {
  paving: 'assets/buildings/CC_HALL_14_paving.webp',
  lawn: 'assets/buildings/CC_HALL_14_lawn.webp'
};
/** Tile size in metres, and the grid the site is tested on. */
const GROUND_TILE_SIZE = 4;
/** Height above SITE_GROUND. Layers closer than ~8 cm z-fight with camera near = 5. */
const GROUND_TILE_LIFT = 0.2;
/** A tile is lawn when every cell this many cells around it is empty too; tiles nearer anything are paving. */
const LAWN_MARGIN_CELLS = 2;
/** Trees stand on the ground; tiles go under them instead of leaving a hole round each one. */
const GROUND_TILE_PASS_THROUGH = /^TREES/;
/** Bucket size, in metres, of the top-down triangle index the empty-ground test uses. */
const TOP_DOWN_BUCKET = 8;

/** Draco decoder files, copied from three/examples/jsm/libs/draco/gltf (the building GLBs are Draco-compressed). */
const DRACO_DECODER_PATH = 'assets/draco/';

/** Sky straight overhead. The sky dome blends from this down to SKY_HORIZON_COLOR. */
const SKY_ZENITH_COLOR = 0x6f9ccc;

/**
 * Hazy daylight horizon. The fog uses the same colour, so distant ground fades into the
 * sky with no visible line - that is what hides the edge of the model.
 */
const SKY_HORIZON_COLOR = 0xd6dee4;

/**
 * Fog range, in metres beyond the orbit target (the site centre). It is re-applied every
 * frame from the current zoom distance, so the site (about 700 m from centre to its far
 * edge) stays clear at any zoom, while the extended ground melts into haze a short way
 * beyond it - a repeating texture running all the way to the horizon reads as an endless carpet.
 */
const FOG_START_BEYOND_TARGET = 400;
const FOG_END_BEYOND_TARGET = 3500;

/**
 * Name of the model's outermost terrain slab. Its material and UV mapping are reused to
 * extend the ground to the horizon, so the join is invisible.
 */
const CONTEXT_GROUND_NAME = 'CONTEXT_GROUND';

/**
 * Side length of the extended ground plane. Its edge must lie beyond the fog's far limit at
 * every zoom level: maximum orbit distance (~3 km) + FOG_END_BEYOND_TARGET is well inside 15 km.
 */
const GROUND_EXTENSION_SIZE = 30000;

/** How far below the terrain slab's top the extension sits: enough to avoid z-fighting, too little to see. */
const GROUND_EXTENSION_DROP = 0.05;

/** Name given to the extension mesh, so it can be hidden once the satellite ground is in. */
const GROUND_EXTENSION_NAME = 'CONTEXT_GROUND_EXTENSION';

/**
 * Satellite ground: Esri World Imagery aligned to the model, built by
 * backend-nest/scripts/tools/build-satellite-ground.py. The manifest lists each image with
 * its four corners in the model's own (x, z) metres, outermost layer first.
 */
const SATELLITE_MANIFEST_URL = 'assets/satellite/satellite.json';

/**
 * How far below the terrain slab's top the imagery sits. The imagery does not write depth and
 * is drawn before the model, so it never z-fights; the drop only keeps it clear of the slab.
 */
const SATELLITE_DROP = 0.3;

interface SatelliteManifest {
  attribution: string;
  /** Compact credit shown by default; the full attribution opens on click. */
  attributionShort: string;
  layers: { name: string; image: string; corners: [number, number][] }[];
}

/** Sky dome radius; inside the camera's far plane (20 000 m). */
const SKY_RADIUS = 18000;

/** Light, slightly cool tone for the reflection environment, so metallic roofs still catch light. */
const ENVIRONMENT_COLOR = 0xcfd8dc;

/** Extra room around the model when framing it, so its edges are not flush with the viewport. */
const FRAME_PADDING = 1.08;

/** Camera tilt above the ground when the site is first framed. Low enough to read as a 3D view. */
const CAMERA_ELEVATION_DEG = 32;

/** Factor applied to the camera distance by the zoom buttons. */
const ZOOM_STEP = 0.8;

/**
 * Earth shown when the user zooms out past the venue's limit (blender-prototype/prepare-earth.py).
 * The globe has radius 1, is centred on the origin and is turned so New Delhi sits at (0, 0, 1), north up.
 */
const EARTH_MODEL_URL = 'assets/globe/EARTH.glb';

/**
 * Globe camera distances from the Earth's centre, in Earth radii. The minimum doubles as the dive point:
 * one more zoom-in from there enters the venue, so it is kept where the Earth already fills the screen.
 */
const GLOBE_MIN_DISTANCE = 1.5;
const GLOBE_MAX_DISTANCE = 6;
const GLOBE_HOME_DISTANCE = 3.2;
/** Camera height above Delhi, in Earth radii, at the end of the dive into the venue. */
const GLOBE_DIVE_DISTANCE = 1.04;

/** Delhi pin on the globe (Earth radii). */
const PIN_POSITION = new THREE.Vector3(0, 0, 1.004);

/**
 * Gap in screen pixels between the pin and its label, bridged by the label's stem (CSS). Done in screen
 * space because a 3D line standing on the pin points at the camera when you look straight down at Delhi.
 */
const PIN_LABEL_OFFSET_PX = 44;

/** Deep space behind the globe; also the page colour the canvas fades through between the two views. */
const SPACE_COLOR = 0x0b1020;

/** Venue <-> globe transition timings. */
const FADE_MS = 280;
const FLY_MS = 1100;

type LoadState = 'loading' | 'ready' | 'error';
type ViewMode = 'venue' | 'globe';

/** A camera move in progress: the offset from the target swings on a sphere (never through the globe). */
interface Flight {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromDir: THREE.Vector3;
  turn: THREE.Quaternion;
  fromDistance: number;
  toDistance: number;
  start: number;
  duration: number;
  done: () => void;
}

/**
 * Home page: renders the full IITF 2026 venue model.
 *
 * Like `Scene3dComponent`, this component owns the Three.js lifecycle directly
 * and is self-contained - there is no shared state to put in a service. The
 * render loop runs outside Angular so 60 frames a second do not trigger change
 * detection; only the loading/error signals touch the template.
 */
@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.css',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements AfterViewInit, OnDestroy {
  readonly state = signal<LoadState>('loading');
  /** Percent loaded, or null when the server sends no Content-Length. */
  readonly progress = signal<number | null>(0);
  readonly loadedMb = signal(0);
  /**
   * Credit for the satellite imagery; null until the imagery is on screen. The imagery licence
   * requires it to stay visible, so it is shown compact and expands on click rather than hidden.
   */
  readonly imageryCredit = signal<{ full: string; short: string } | null>(null);
  readonly creditExpanded = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly globeLabel = viewChild.required<ElementRef<HTMLDivElement>>('globeLabel');
  private readonly zone = inject(NgZone);

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private sun!: THREE.DirectionalLight;
  private sky!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private environment?: THREE.WebGLRenderTarget;
  private model?: THREE.Object3D;
  private frameId = 0;
  private destroyed = false;

  /** Camera position and target after framing, restored by the reset button. */
  private readonly homePosition = new THREE.Vector3();
  private readonly homeTarget = new THREE.Vector3();

  /** Globe view: its own scene, camera and controls; only one set of controls is enabled at a time. */
  private mode: ViewMode = 'venue';
  private globeScene!: THREE.Scene;
  private globeCamera!: THREE.PerspectiveCamera;
  private globeControls!: OrbitControls;
  private globeReady = false;
  private transitioning = false;
  private flight?: Flight;

  ngAfterViewInit(): void {
    const canvas = this.canvas().nativeElement;

    this.scene = new THREE.Scene();
    // Only visible if the sky dome is ever clipped; same colour as the horizon so it never shows as a band.
    this.scene.background = new THREE.Color(SKY_HORIZON_COLOR);
    // Near/far are set per frame from the zoom distance (see updateFog()).
    this.scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, FOG_START_BEYOND_TARGET, FOG_END_BEYOND_TARGET);

    // near = 5, not 1: the ground layers sit 8-25 cm apart and z-fight without the depth precision.
    this.camera = new THREE.PerspectiveCamera(50, 1, 5, 20000);
    this.camera.position.set(0, 50, 100);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // ACES with slightly reduced exposure keeps the pale site surfaces from clipping to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.addLights();
    this.addEnvironment();
    this.addSky();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Keep the camera above the ground plane.
    this.controls.maxPolarAngle = Math.PI / 2.05;

    this.setupGlobe(canvas);

    this.resize();
    this.loadModel();
    void this.loadEarth();

    this.zone.runOutsideAngular(() => {
      window.addEventListener('resize', this.onResize);
      canvas.addEventListener('wheel', this.onWheel, { passive: true });
      this.animate();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResize);
    this.canvas().nativeElement.removeEventListener('wheel', this.onWheel);

    if (!this.renderer) return;

    this.disposeModel();
    this.disposeObject(this.globeScene);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.environment?.dispose();
    this.controls.dispose();
    this.globeControls.dispose();
    this.renderer.dispose();
  }

  // --- template actions ----------------------------------------------------

  retry(): void {
    this.loadModel();
  }

  zoomIn(): void {
    if (this.transitioning) return;
    if (this.mode === 'globe') {
      if (this.globeAtClosest()) void this.enterVenue();
      else this.dolly(this.globeCamera, this.globeControls, ZOOM_STEP);
      return;
    }
    this.dolly(this.camera, this.controls, ZOOM_STEP);
  }

  zoomOut(): void {
    if (this.transitioning) return;
    if (this.mode === 'venue' && this.venueAtFarthest()) {
      void this.enterGlobe();
      return;
    }
    const [camera, controls] = this.mode === 'globe' ? [this.globeCamera, this.globeControls] : [this.camera, this.controls];
    this.dolly(camera, controls, 1 / ZOOM_STEP);
  }

  toggleCredit(): void {
    this.creditExpanded.update(open => !open);
  }

  resetView(): void {
    if (this.transitioning) return;
    // From the globe, "reset" means back to the venue's home view.
    if (this.mode === 'globe') {
      void this.enterVenue();
      return;
    }
    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
  }

  // --- scene setup -----------------------------------------------------------

  /**
   * Sky/ground fill plus one shadow-casting sun. A flat AmbientLight lit every face equally,
   * which is what made the buildings read as paper cutouts.
   *
   * The shadow camera covers the IITF site model (about 1343 x 924 m), which frameModel()
   * re-centres on the origin, so the sun's default target (the origin) is the model centre.
   */
  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0xb8b0a4, 0.5));

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    this.sun.position.set(500, 800, 300);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.camera.left = -900;
    this.sun.shadow.camera.right = 900;
    this.sun.shadow.camera.top = 700;
    this.sun.shadow.camera.bottom = -700;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 3000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  /**
   * Metallic roofs reflect their surroundings; with no environment they
   * reflect black and look dark however bright the lights are. A scene with
   * only a light background colour, pre-filtered by PMREMGenerator, gives
   * them an even, bright reflection without shipping an HDR file.
   */
  private addEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(ENVIRONMENT_COLOR);

    this.environment = pmrem.fromScene(envScene);
    this.scene.environment = this.environment.texture;
    // Reflections only: at full strength the env map adds a third full light and washes out ACES.
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
  }

  /**
   * Gradient sky: a large inside-out sphere with per-vertex colours, zenith blue fading to the
   * hazy horizon. Vertex colours instead of a custom shader, so the sky goes through the same
   * tone mapping as the fogged ground and the two meet at exactly the same colour.
   * The dome follows the camera (see animate()) so the horizon never shifts as you orbit.
   */
  private addSky(): void {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const zenith = new THREE.Color(SKY_ZENITH_COLOR);
    const horizon = new THREE.Color(SKY_HORIZON_COLOR);
    const color = new THREE.Color();
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const height = Math.max(positions.getY(i) / SKY_RADIUS, 0);
      // Square-root curve: the blue builds quickly above the horizon, as in a real sky.
      color.copy(horizon).lerp(zenith, Math.sqrt(height));
      color.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    });
    this.sky = new THREE.Mesh(geometry, material);
    // It moves with the camera, so its bounding sphere is never where the culler expects it.
    this.sky.frustumCulled = false;
    // Drawn first: it writes no depth, so anything drawn before it would be painted over.
    this.sky.renderOrder = -3;
    this.scene.add(this.sky);
  }

  /**
   * Continues the model's outermost terrain to the horizon, so the site no longer sits on a
   * floating slab with a hard edge.
   *
   * The plane reuses the terrain's own material, and its UVs come from the same planar
   * mapping the terrain uses (fitted from the slab's top face), so the texture carries on
   * across the join without a seam. Added as a child of the model, after framing, so it moves
   * with the model, is disposed with it, and does not affect the camera fit.
   */
  private extendGround(model: THREE.Object3D): void {
    const terrain = model.getObjectByName(CONTEXT_GROUND_NAME) as THREE.Mesh | undefined;
    if (!terrain?.isMesh) {
      console.warn(`No "${CONTEXT_GROUND_NAME}" mesh in the venue model; ground not extended.`);
      return;
    }

    const mapping = this.fitTerrainUv(terrain.geometry);
    if (!mapping) {
      console.warn(`"${CONTEXT_GROUND_NAME}" has no usable UVs; ground not extended.`);
      return;
    }

    const half = GROUND_EXTENSION_SIZE / 2;
    const y = mapping.topY - GROUND_EXTENSION_DROP;
    const corners = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half]
    ];
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const [x, z] of corners) {
      positions.push(x, y, z);
      uvs.push(mapping.u(x, z), mapping.v(x, z));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // Counter-clockwise seen from above, so the face points up.
    geometry.setIndex([0, 3, 2, 0, 2, 1]);
    geometry.computeVertexNormals();

    const extension = new THREE.Mesh(geometry, terrain.material);
    extension.name = GROUND_EXTENSION_NAME;
    extension.receiveShadow = true;
    // Same local frame as the terrain slab, so the fitted UV mapping lines up.
    terrain.parent!.add(extension);
    extension.position.copy(terrain.position);
    extension.quaternion.copy(terrain.quaternion);
    extension.scale.copy(terrain.scale);
  }

  /**
   * Recovers the terrain's planar texture mapping, u = a·x + b·z + c and v = d·x + e·z + f,
   * from three corners of its top face. Returns null if the geometry has no UVs or its top
   * face is degenerate.
   */
  private fitTerrainUv(
    geometry: THREE.BufferGeometry
  ): { topY: number; u: (x: number, z: number) => number; v: (x: number, z: number) => number } | null {
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    if (!pos || !uv) return null;

    let topY = -Infinity;
    for (let i = 0; i < pos.count; i++) topY = Math.max(topY, pos.getY(i));

    // Distinct top-face corners (the slab repeats each corner once per triangle).
    const top: { x: number; z: number; u: number; v: number }[] = [];
    for (let i = 0; i < pos.count && top.length < 3; i++) {
      if (Math.abs(pos.getY(i) - topY) > 1e-3) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (top.some(p => Math.abs(p.x - x) < 1e-3 && Math.abs(p.z - z) < 1e-3)) continue;
      top.push({ x, z, u: uv.getX(i), v: uv.getY(i) });
    }
    if (top.length < 3) return null;

    const [p0, p1, p2] = top;
    const det = (p1.x - p0.x) * (p2.z - p0.z) - (p2.x - p0.x) * (p1.z - p0.z);
    if (Math.abs(det) < 1e-6) return null;

    // Solve the 2x2 system for each of u and v (Cramer's rule).
    const solve = (k0: number, k1: number, k2: number) => {
      const a = ((k1 - k0) * (p2.z - p0.z) - (k2 - k0) * (p1.z - p0.z)) / det;
      const b = ((p1.x - p0.x) * (k2 - k0) - (p2.x - p0.x) * (k1 - k0)) / det;
      return (x: number, z: number) => k0 + a * (x - p0.x) + b * (z - p0.z);
    };
    return { topY, u: solve(p0.u, p1.u, p2.u), v: solve(p0.v, p1.v, p2.v) };
  }

  /**
   * Replaces the beige terrain around the site with real satellite imagery (see
   * SATELLITE_MANIFEST_URL). Each image becomes one flat quad in the terrain's local frame,
   * placed by the corners in the manifest, so the imagery lines up with the model's buildings.
   *
   * The quads write no depth and are drawn before everything else (outer layer, then inner),
   * so they sit underneath the model like a printed map and can never z-fight with its ground
   * layers. Only once every image has loaded are the terrain slab and its extension hidden;
   * if anything fails, those stay as the fallback.
   */
  private async addSatelliteGround(model: THREE.Object3D): Promise<void> {
    const terrain = model.getObjectByName(CONTEXT_GROUND_NAME) as THREE.Mesh | undefined;
    if (!terrain?.isMesh || !terrain.parent) return;

    let manifest: SatelliteManifest;
    let textures: THREE.Texture[];
    try {
      const response = await fetch(SATELLITE_MANIFEST_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      manifest = (await response.json()) as SatelliteManifest;
      const base = SATELLITE_MANIFEST_URL.slice(0, SATELLITE_MANIFEST_URL.lastIndexOf('/') + 1);
      const loader = new THREE.TextureLoader();
      textures = await Promise.all(manifest.layers.map(layer => loader.loadAsync(base + layer.image)));
    } catch (error) {
      console.warn('Satellite ground not loaded; keeping the plain terrain.', error);
      return;
    }

    // The model may have been reloaded or the page left while the images were downloading.
    if (this.destroyed || this.model !== model) {
      textures.forEach(t => t.dispose());
      return;
    }

    terrain.geometry.computeBoundingBox();
    const y = terrain.geometry.boundingBox!.max.y - SATELLITE_DROP;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();

    manifest.layers.forEach((layer, i) => {
      const texture = textures[i];
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = aniso;

      const quad = this.buildImageryQuad(layer.corners, y, texture);
      quad.name = `SATELLITE_${layer.name.toUpperCase()}`;
      // Before the model (0) and after the sky (-3); later layers draw over earlier ones.
      quad.renderOrder = -2 + i / manifest.layers.length;
      terrain.parent!.add(quad);
      quad.position.copy(terrain.position);
      quad.quaternion.copy(terrain.quaternion);
      quad.scale.copy(terrain.scale);
    });

    terrain.visible = false;
    const extension = model.getObjectByName(GROUND_EXTENSION_NAME);
    if (extension) extension.visible = false;
    this.imageryCredit.set({ full: manifest.attribution, short: manifest.attributionShort });
  }

  /**
   * One flat, lit, depth-less quad for an image. `corners` are the image's top-left, top-right,
   * bottom-right and bottom-left corners as (x, z) in the terrain's frame.
   */
  private buildImageryQuad(corners: [number, number][], y: number, texture: THREE.Texture): THREE.Mesh {
    const positions = corners.flatMap(([x, z]) => [x, y, z]);
    // Textures load with flipY, so v = 1 is the top edge of the image.
    const uvs = [0, 1, 1, 1, 1, 0, 0, 0];

    // Wind the two triangles so the face points up, whichever way the corners turn.
    const [a, b, c] = corners;
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
    const index = up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      metalness: 0,
      depthWrite: false
    });
    const quad = new THREE.Mesh(geometry, material);
    // Building and tree shadows fall onto the imagery, which ties the model to the ground.
    quad.receiveShadow = true;
    return quad;
  }

  // --- globe view ------------------------------------------------------------

  /**
   * Separate scene for the Earth. It cannot share the venue's scene: the Earth is 6371 km across and the
   * site 1.4 km, and one depth buffer cannot hold both. The two views are swapped behind a short fade.
   */
  private setupGlobe(canvas: HTMLCanvasElement): void {
    this.globeScene = new THREE.Scene();
    this.globeScene.background = new THREE.Color(SPACE_COLOR);

    this.globeCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    this.globeCamera.position.set(0, 0, GLOBE_HOME_DISTANCE);

    this.globeControls = new OrbitControls(this.globeCamera, canvas);
    this.globeControls.enabled = false;
    this.globeControls.enableDamping = true;
    this.globeControls.dampingFactor = 0.08;
    this.globeControls.enablePan = false;
    this.globeControls.rotateSpeed = 0.5;
    this.globeControls.minDistance = GLOBE_MIN_DISTANCE;
    this.globeControls.maxDistance = GLOBE_MAX_DISTANCE;

    this.globeScene.add(new THREE.AmbientLight(0xffffff, 0.35));
    // From over the viewer's shoulder, so Delhi is on the day side when the globe first appears.
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 2, 4);
    this.globeScene.add(sun);

    // Thin halo: a back-facing shell just larger than the globe shows only as a rim around it.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.025, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0x6fb2ff, transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false })
    );
    this.globeScene.add(atmosphere);

    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    pin.position.copy(PIN_POSITION);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.02, 0.028, 32),
      new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    ring.position.set(0, 0, 1.002);
    this.globeScene.add(pin, ring);

    this.globeScene.add(this.buildStars());
  }

  /**
   * Keeps the HTML label just above the pin on screen, its stem reaching down to the pin. Hidden when the
   * pin has rotated to the far side of the Earth, and during the dive, when the camera is too close.
   */
  private updateGlobeLabel(): void {
    const label = this.globeLabel().nativeElement;
    const camDistance = this.globeCamera.position.length();
    const facing = this.globeCamera.position.clone().normalize().dot(PIN_POSITION.clone().normalize());
    const visible = this.mode === 'globe' && facing > 0.2 && camDistance > GLOBE_MIN_DISTANCE * 0.9;
    label.style.opacity = visible ? '1' : '0';
    if (!visible) return;

    const canvas = this.canvas().nativeElement;
    const p = PIN_POSITION.clone().project(this.globeCamera);
    const x = ((p.x + 1) / 2) * canvas.clientWidth;
    const y = ((1 - p.y) / 2) * canvas.clientHeight;
    label.style.setProperty('--stem', `${PIN_LABEL_OFFSET_PX}px`);
    label.style.transform = `translate(${x}px, ${y}px) translate(-50%, calc(-100% - ${PIN_LABEL_OFFSET_PX}px))`;
  }

  private buildStars(): THREE.Points {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(60 + Math.random() * 40);
      v.toArray(positions, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, sizeAttenuation: true }));
  }

  /** Loads the Earth in the background; until it is in, zooming out simply stops at the venue's limit. */
  private async loadEarth(): Promise<void> {
    let earth: GLTF;
    try {
      earth = await new GLTFLoader().loadAsync(EARTH_MODEL_URL);
    } catch (error) {
      console.warn('Earth globe not loaded; zooming out stays in the venue view.', error);
      return;
    }
    if (this.destroyed) {
      this.disposeObject(earth.scene);
      return;
    }
    this.prepareMeshes(earth.scene);
    this.globeScene.add(earth.scene);
    this.globeReady = true;
  }

  private venueAtFarthest(): boolean {
    return this.camera.position.distanceTo(this.controls.target) >= this.controls.maxDistance * 0.97;
  }

  private globeAtClosest(): boolean {
    return this.globeCamera.position.length() <= GLOBE_MIN_DISTANCE * 1.03;
  }

  /** One more scroll past a view's zoom limit switches views. */
  private readonly onWheel = (event: WheelEvent): void => {
    if (this.transitioning) return;
    if (this.mode === 'venue' && event.deltaY > 0 && this.venueAtFarthest()) void this.enterGlobe();
    else if (this.mode === 'globe' && event.deltaY < 0 && this.globeAtClosest()) void this.enterVenue();
  };

  /** Venue -> globe: fade out, appear just above Delhi, then pull back to show the whole Earth. */
  private async enterGlobe(): Promise<void> {
    if (!this.globeReady) return;
    this.transitioning = true;
    this.controls.enabled = false;
    await this.fade(0);

    this.mode = 'globe';
    this.globeCamera.position.set(0, 0, GLOBE_MIN_DISTANCE);
    this.globeControls.target.set(0, 0, 0);
    this.globeControls.update();
    await this.fade(1);
    await this.fly(this.globeCamera, this.globeControls, new THREE.Vector3(0, 0.25, 1).setLength(GLOBE_HOME_DISTANCE), new THREE.Vector3());

    this.globeControls.enabled = true;
    this.transitioning = false;
  }

  /** Globe -> venue: swing round to Delhi and dive, fade, then settle from far out onto the home view. */
  private async enterVenue(): Promise<void> {
    this.transitioning = true;
    this.globeControls.enabled = false;
    await this.fly(this.globeCamera, this.globeControls, new THREE.Vector3(0, 0, GLOBE_DIVE_DISTANCE), new THREE.Vector3());
    await this.fade(0);

    this.mode = 'venue';
    const offset = this.homePosition.clone().sub(this.homeTarget).setLength(this.controls.maxDistance * 0.95);
    this.camera.position.copy(this.homeTarget).add(offset);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
    await this.fade(1);
    await this.fly(this.camera, this.controls, this.homePosition.clone(), this.homeTarget.clone());

    this.controls.enabled = true;
    this.transitioning = false;
  }

  private fade(opacity: number): Promise<void> {
    const canvas = this.canvas().nativeElement;
    canvas.style.transition = `opacity ${FADE_MS}ms ease`;
    canvas.style.opacity = String(opacity);
    return new Promise(resolve => setTimeout(resolve, FADE_MS));
  }

  /** Starts a camera move; animate() advances it. Resolves when the camera arrives. */
  private fly(camera: THREE.PerspectiveCamera, controls: OrbitControls, toPosition: THREE.Vector3, toTarget: THREE.Vector3): Promise<void> {
    const fromOffset = camera.position.clone().sub(controls.target);
    const toOffset = toPosition.clone().sub(toTarget);
    return new Promise(resolve => {
      this.flight = {
        camera,
        controls,
        fromTarget: controls.target.clone(),
        toTarget,
        fromDir: fromOffset.clone().normalize(),
        turn: new THREE.Quaternion().setFromUnitVectors(fromOffset.clone().normalize(), toOffset.clone().normalize()),
        fromDistance: fromOffset.length(),
        toDistance: toOffset.length(),
        start: performance.now(),
        duration: FLY_MS,
        done: resolve
      };
    });
  }

  private updateFlight(): void {
    const f = this.flight;
    if (!f) return;
    const t = Math.min((performance.now() - f.start) / f.duration, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in-out cubic
    const dir = f.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(f.turn, e));
    f.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    f.camera.position.copy(f.controls.target).addScaledVector(dir, THREE.MathUtils.lerp(f.fromDistance, f.toDistance, e));
    f.camera.lookAt(f.controls.target);
    if (t === 1) {
      this.flight = undefined;
      f.controls.update();
      f.done();
    }
  }

  // --- model loading ---------------------------------------------------------

  private loadModel(): void {
    this.disposeModel();
    this.state.set('loading');
    this.progress.set(0);
    this.loadedMb.set(0);
    this.imageryCredit.set(null);

    new GLTFLoader().load(
      MODEL_URL,
      gltf => this.onLoaded(gltf),
      xhr => {
        this.loadedMb.set(xhr.loaded / (1024 * 1024));
        // `total` is 0 when the response has no Content-Length (e.g. compressed).
        this.progress.set(xhr.total > 0 ? Math.round((xhr.loaded / xhr.total) * 100) : null);
      },
      error => {
        console.error('Failed to load venue model', MODEL_URL, error);
        this.state.set('error');
      }
    );
  }

  private onLoaded(gltf: GLTF): void {
    // The page may have been left while the 50 MB file was still downloading.
    if (this.destroyed) {
      this.disposeObject(gltf.scene);
      return;
    }

    this.model = gltf.scene;
    this.prepareMeshes(this.model);
    this.scene.add(this.model);
    // Framing depends on the aspect ratio; refresh it now, the canvas may have been laid out
    // (or resized) since ngAfterViewInit measured it.
    this.resize();
    this.frameModel(this.model);
    // After framing: the 30 km extension must not count towards the camera fit.
    this.extendGround(this.model);
    this.state.set('ready');
    // Streams in after the model is already visible; the plain terrain shows until it arrives.
    void this.addSatelliteGround(this.model);
    // Tiles after the buildings: which ground is empty depends on what they cover and hide.
    const model = this.model;
    void this.addDetailedBuildings(model).then(() => this.addGroundTiles(model));
  }

  /** Shadows both ways, plus anisotropy: tiled ground textures are seen at grazing angles and smear to flat grey without it. */
  private prepareMeshes(root: THREE.Object3D): void {
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) {
          map.anisotropy = aniso;
          map.needsUpdate = true;
        }
      });
    });
  }

  /**
   * Swaps simple venue nodes for the detailed buildings in DETAILED_BUILDINGS. Each is added next to the
   * node it replaces (same parent), so it shares the venue's frame and the re-centring done by
   * frameModel(). A node - and any in `alsoHides` - is hidden only once its replacement is in; a failed
   * download leaves them as the fallback.
   */
  private async addDetailedBuildings(model: THREE.Object3D): Promise<void> {
    const draco = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
    const loader = new GLTFLoader().setDRACOLoader(draco);

    await Promise.all(
      DETAILED_BUILDINGS.map(async ({ url, replaces, alsoHides = [] }) => {
        const old = model.getObjectByName(replaces);
        if (!old?.parent) return;

        let building: GLTF;
        try {
          building = await loader.loadAsync(url);
        } catch (error) {
          console.warn(`Detailed building ${url} not loaded; keeping ${replaces}.`, error);
          return;
        }

        // The model may have been reloaded or the page left while the building was downloading.
        if (this.destroyed || this.model !== model) {
          this.disposeObject(building.scene);
          return;
        }

        this.prepareMeshes(building.scene);
        old.parent.add(building.scene);
        old.visible = false;
        for (const name of alsoHides) {
          const other = model.getObjectByName(name);
          if (other) other.visible = false;
        }
      })
    );
    draco.dispose();
  }

  /**
   * Covers the site's plain asphalt with paving and lawn tiles. Runs once, after the detailed buildings.
   *
   * A GROUND_TILE_SIZE cell is empty when rays straight down its centre and its four corners all hit
   * SITE_GROUND first: nothing on top - no building, road, lawn, paving, walkway or gate. Checking the
   * corners too keeps a tile from reaching over the edge of a road next to it.
   *
   * Empty cells become one InstancedMesh per texture: lawn well inside an empty area, paving near
   * anything. They sit GROUND_TILE_LIFT above SITE_GROUND and only receive shadows.
   */
  private async addGroundTiles(model: THREE.Object3D): Promise<void> {
    if (this.destroyed || this.model !== model) return;
    const ground = model.getObjectByName(SITE_GROUND_NAME) as THREE.Mesh | undefined;
    if (!ground?.isMesh || !ground.parent) return;

    let maps: THREE.Texture[];
    try {
      const loader = new THREE.TextureLoader();
      maps = await Promise.all([loader.loadAsync(GROUND_TILE_MAPS.paving), loader.loadAsync(GROUND_TILE_MAPS.lawn)]);
    } catch (error) {
      console.warn('Ground tile textures not loaded; the site keeps its plain asphalt.', error);
      return;
    }
    // The model may have been reloaded or the page left while the textures were downloading.
    if (this.destroyed || this.model !== model) {
      maps.forEach(m => m.dispose());
      return;
    }

    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(ground);
    const firstHit = this.buildTopDownIndex(model, bounds);
    const groundHeight = (x: number, z: number): number | null => {
      const hit = firstHit(x, z);
      return hit?.mesh === ground ? hit.y : null;
    };

    const size = GROUND_TILE_SIZE;
    const cols = Math.floor((bounds.max.x - bounds.min.x) / size);
    const rows = Math.floor((bounds.max.z - bounds.min.z) / size);
    const x0 = bounds.min.x;
    const z0 = bounds.min.z;

    // Corner rays are shared by the four cells around each corner.
    const cornerOnGround = new Uint8Array((cols + 1) * (rows + 1));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        cornerOnGround[r * (cols + 1) + c] = groundHeight(x0 + c * size, z0 + r * size) === null ? 0 : 1;
      }
    }
    const height = new Float32Array(cols * rows).fill(NaN); // NaN = not empty
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * (cols + 1) + c;
        if (!(cornerOnGround[k] && cornerOnGround[k + 1] && cornerOnGround[k + cols + 1] && cornerOnGround[k + cols + 2])) continue;
        const y = groundHeight(x0 + (c + 0.5) * size, z0 + (r + 0.5) * size);
        if (y !== null) height[r * cols + c] = y;
      }
    }

    const isEmpty = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && !isNaN(height[r * cols + c]);
    const isLawn = (c: number, r: number) => {
      for (let dr = -LAWN_MARGIN_CELLS; dr <= LAWN_MARGIN_CELLS; dr++) {
        for (let dc = -LAWN_MARGIN_CELLS; dc <= LAWN_MARGIN_CELLS; dc++) {
          if (!isEmpty(c + dc, r + dr)) return false;
        }
      }
      return true;
    };
    const cells: [THREE.Vector3[], THREE.Vector3[]] = [[], []]; // [paving, lawn], world centres
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isEmpty(c, r)) continue;
        const centre = new THREE.Vector3(x0 + (c + 0.5) * size, height[r * cols + c] + GROUND_TILE_LIFT, z0 + (r + 0.5) * size);
        cells[isLawn(c, r) ? 1 : 0].push(centre);
      }
    }

    const geometry = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const matrix = new THREE.Matrix4();
    ['PAVING', 'LAWN'].forEach((kind, i) => {
      const map = maps[i];
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = aniso;
      const tiles = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }), cells[i].length);
      tiles.name = `GROUND_TILES_${kind}`;
      // Same parent as SITE_GROUND, so the tiles move and are disposed with the model.
      cells[i].forEach((centre, k) => tiles.setMatrixAt(k, matrix.makeTranslation(ground.parent!.worldToLocal(centre))));
      tiles.computeBoundingSphere();
      tiles.receiveShadow = true;
      ground.parent!.add(tiles);
    });
  }

  /**
   * A vertical "raycaster" over every visible mesh in the model: for a ray straight down at world (x, z),
   * the mesh it hits first and at what height. Built once for addGroundTiles().
   *
   * Every ray points straight down, so its first hit is simply the highest triangle over that point.
   * Triangles are sorted into TOP_DOWN_BUCKET-metre 2D buckets once, so a ray tests only the few in its
   * bucket. THREE.Raycaster would test every triangle of every mesh under the ray - the new CC / Hall 14
   * alone is 300k triangles - which took about a minute for the ~115k rays; this takes ~0.1 s.
   */
  private buildTopDownIndex(model: THREE.Object3D, bounds: THREE.Box3): (x: number, z: number) => { mesh: THREE.Mesh; y: number } | null {
    const meshes: THREE.Mesh[] = [];
    model.traverseVisible(o => {
      if ((o as THREE.Mesh).isMesh && !GROUND_TILE_PASS_THROUGH.test(o.name)) meshes.push(o as THREE.Mesh);
    });

    // Every triangle in world space: 9 floats (three corners), plus the index of the mesh it belongs to.
    let count = 0;
    for (const mesh of meshes) count += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
    const corners = new Float32Array(count * 9);
    const owner = new Uint16Array(count);
    const v = new THREE.Vector3();
    let t = 0;
    meshes.forEach((mesh, m) => {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index;
      const n = index?.count ?? position.count;
      for (let k = 0; k < n; k++) {
        v.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld);
        v.toArray(corners, t * 9 + (k % 3) * 3);
        if (k % 3 === 2) owner[t++] = m;
      }
    });

    const B = TOP_DOWN_BUCKET;
    const cols = Math.ceil((bounds.max.x - bounds.min.x) / B);
    const rows = Math.ceil((bounds.max.z - bounds.min.z) / B);
    const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
    for (let i = 0; i < count; i++) {
      const o = i * 9;
      const ax = corners[o], az = corners[o + 2], bx = corners[o + 3], bz = corners[o + 5], cx = corners[o + 6], cz = corners[o + 8];
      // A wall seen from above has no area; a vertical ray never hits it.
      if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) < 1e-6) continue;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - bounds.min.x) / B));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - bounds.min.x) / B));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - bounds.min.z) / B));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - bounds.min.z) / B));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(i);
    }

    return (x, z) => {
      const c = Math.floor((x - bounds.min.x) / B);
      const r = Math.floor((z - bounds.min.z) / B);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
      let best = -1;
      let bestY = -Infinity;
      for (const i of buckets[r * cols + c]) {
        const o = i * 9;
        const ax = corners[o], az = corners[o + 2], bx = corners[o + 3], bz = corners[o + 5], cx = corners[o + 6], cz = corners[o + 8];
        // Barycentric weights of (x, z) in the triangle's top-down projection.
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const y = w0 * corners[o + 1] + w1 * corners[o + 4] + w2 * corners[o + 7];
        if (y > bestY) {
          bestY = y;
          best = owner[i];
        }
      }
      return best < 0 ? null : { mesh: meshes[best], y: bestY };
    };
  }

  /** Centres the model on the origin and moves the camera so all of it is in view. */
  private frameModel(model: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    model.position.sub(center);

    // Oblique view: fit the site's ground footprint (width across the screen, depth up it),
    // whichever is tighter, then tilt the camera CAMERA_ELEVATION_DEG above the ground.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const elevation = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
    const fitWidth = size.x / 2 / Math.tan(hFov / 2);
    // Seen at this tilt, the footprint's depth spans roughly depth * sin(elevation) on screen.
    const fitDepth = (size.z * Math.sin(elevation) + size.y) / 2 / Math.tan(vFov / 2);
    const distance = Math.max(fitWidth, fitDepth, maxDim * 0.3) * FRAME_PADDING;

    this.camera.position.set(0, distance * Math.sin(elevation), distance * Math.cos(elevation));
    this.camera.updateProjectionMatrix();

    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = maxDim * 0.05;
    this.controls.maxDistance = distance * 3;
    this.controls.update();

    this.homePosition.copy(this.camera.position);
    this.homeTarget.copy(this.controls.target);
  }

  // --- render loop and resize ------------------------------------------------

  private readonly animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    this.updateFlight();

    this.updateGlobeLabel();
    if (this.mode === 'globe') {
      if (!this.flight) this.globeControls.update();
      this.renderer.render(this.globeScene, this.globeCamera);
      return;
    }

    // Required every frame while damping is enabled (skipped while a flight is placing the camera).
    if (!this.flight) this.controls.update();
    this.sky.position.copy(this.camera.position);
    this.updateFog();
    this.renderer.render(this.scene, this.camera);
  };

  /** Keeps the haze just beyond the site whatever the zoom level, so zooming out never fogs the venue itself. */
  private updateFog(): void {
    const fog = this.scene.fog as THREE.Fog;
    const distance = this.camera.position.distanceTo(this.controls.target);
    fog.near = distance + FOG_START_BEYOND_TARGET;
    fog.far = distance + FOG_END_BEYOND_TARGET;
  }

  private readonly onResize = (): void => this.resize();

  private resize(): void {
    const canvas = this.canvas().nativeElement;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.globeCamera.aspect = width / height;
    this.globeCamera.updateProjectionMatrix();
    // `false` leaves the CSS size alone; the stylesheet controls it.
    this.renderer.setSize(width, height, false);
  }

  /** Moves the camera toward (factor < 1) or away from (factor > 1) the orbit target. */
  private dolly(camera: THREE.PerspectiveCamera, controls: OrbitControls, factor: number): void {
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    const distance = THREE.MathUtils.clamp(offset.length(), controls.minDistance, controls.maxDistance);
    offset.setLength(distance);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  // --- cleanup ---------------------------------------------------------------

  private disposeModel(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.disposeObject(this.model);
    this.model = undefined;
  }

  /**
   * Frees GPU memory held by a loaded glTF. Unlike `disposeChildren` in
   * stall3d-renderer.ts this also disposes textures, because the venue model
   * ships its own images.
   */
  private disposeObject(root: THREE.Object3D): void {
    const materials = new Set<THREE.Material>();

    root.traverse(child => {
      const mesh = child as Partial<THREE.Mesh>;
      mesh.geometry?.dispose();

      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach(m => materials.add(m));
      } else if (material) {
        materials.add(material);
      }
    });

    materials.forEach(material => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    });
  }
}
