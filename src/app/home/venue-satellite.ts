import * as T from 'three';

interface SatelliteManifest {
  layers: { name: string; image: string; corners: [number, number][] }[];
}

/** Two bundled photo layers, loaded once on demand; OSM remains the fallback. */
export function createVenueSatellite(asset: (path: string) => string, renderer: T.WebGLRenderer, signal: AbortSignal) {
  const group = new T.Group();
  group.name = 'Esri satellite context';
  group.visible = false;
  const materials: T.MeshBasicMaterial[] = [];
  let pending: Promise<boolean> | undefined;

  function load(): Promise<boolean> {
    if (materials.length) return Promise.resolve(true);
    if (pending) return pending;
    pending = (async () => {
      let textures: T.Texture[] = [];
      try {
        const response = await fetch(asset('geography/satellite/satellite.json'), { signal });
        if (!response.ok) throw new Error(`Satellite manifest: HTTP ${response.status}`);
        const manifest: SatelliteManifest = await response.json();
        const loader = new T.TextureLoader();
        const results = await Promise.allSettled(manifest.layers.map(layer => loader.loadAsync(asset('geography/satellite/' + layer.image))));
        textures = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        signal.throwIfAborted();
        if (!manifest.layers.length || results.some(result => result.status === 'rejected')) throw new Error('Satellite image unavailable');
        manifest.layers.forEach((layer, index) => {
          const texture = textures[index];
          texture.colorSpace = T.SRGBColorSpace;
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          const geometry = new T.BufferGeometry();
          // At -.35 m / -.34 m in the scene: above the fallback, below campus.
          geometry.setAttribute('position', new T.Float32BufferAttribute(layer.corners.flatMap(([x, z]) => [x, -6.95 + index * .01, z]), 3));
          geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
          geometry.setIndex([0, 2, 1, 0, 3, 2]);
          const material = new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
          const mesh = new T.Mesh(geometry, material);
          mesh.name = 'Satellite ' + layer.name;
          // Fallback first (-3), then photos; campus transparency follows (0).
          mesh.renderOrder = -2 + index;
          materials.push(material);
          group.add(mesh);
        });
        return true;
      } catch (error) {
        textures.forEach(texture => texture.dispose());
        if (!signal.aborted) console.warn('Satellite unavailable; keeping the local map.', error);
        return false;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  }

  return { group, load, setOpacity: (opacity: number) => materials.forEach(material => { material.opacity = opacity; }) };
}

interface VenueMapImage {
  image: string;
  size: [number, number];
  worldToImage: { u: [number, number, number]; v: [number, number, number] };
}

/** The existing high-resolution map JPEG has the current z18 fit, unlike the historical broad mosaics.
 * Reuse it in the 3D Map ground, with a 45 m feather into the OSM fallback. No new image asset. */
export function createVenueMapGround(asset: (path: string) => string, renderer: T.WebGLRenderer, signal: AbortSignal) {
  const group = new T.Group(); group.name = 'Registered satellite ground (Color → Map)';
  const imageU = { value: new T.Vector3() }, imageV = { value: new T.Vector3() };
  const imageSize = { value: new T.Vector2(1, 1) }, imageReady = { value: 0 };
  const feather = { value: 68 }; // 1.506 image pixels per venue metre.
  const boundary = { value: new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) as T.Texture };
  boundary.value.needsUpdate = true;
  signal.addEventListener('abort', () => boundary.value.dispose(), { once: true });
  let property: [number, number][][][] | undefined;
  let pending: Promise<boolean> | undefined, material: T.MeshBasicMaterial | undefined;
  const uniforms = { venueImageU: imageU, venueImageV: imageV, venueImageSize: imageSize, venueImageReady: imageReady, venueImageFeather: feather, venueImageBoundary: boundary };
  const declarations = `varying vec2 vVenueImagePosition;
    uniform vec3 venueImageU; uniform vec3 venueImageV; uniform vec2 venueImageSize;
    uniform float venueImageReady; uniform float venueImageFeather;
    uniform sampler2D venueImageBoundary;
    float venueImageCoverage() {
      vec3 point = vec3(vVenueImagePosition, 1.0);
      vec2 pixel = vec2(dot(venueImageU, point), dot(venueImageV, point));
      float edge = min(min(pixel.x, venueImageSize.x - pixel.x), min(pixel.y, venueImageSize.y - pixel.y));
      vec2 uv = pixel / venueImageSize;
      return venueImageReady * smoothstep(0.0, venueImageFeather, edge) * texture2D(venueImageBoundary, vec2(uv.x, 1.0 - uv.y)).r;
    }`;
  function setProperty(polygons: [number, number][][][]) {
    property = polygons;
    if (!imageReady.value) return;
    // A small procedural coverage mask feathers the perimeter without painting over the halls or plazas.
    // It is not another imagery asset; maximum GPU size is 512 × 512, and there is one lookup per fragment.
    const canvas = document.createElement('canvas'); canvas.width = 512;
    canvas.height = Math.max(1, Math.round(512 * imageSize.value.y / imageSize.value.x));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = 'blur(3px)'; ctx.fillStyle = '#000';
    const u = imageU.value, v = imageV.value;
    for (const rings of polygons) {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([x, z], i) => {
          const a = (u.x * x + u.y * z + u.z) / imageSize.value.x * canvas.width;
          const b = (v.x * x + v.y * z + v.z) / imageSize.value.y * canvas.height;
          if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
    boundary.value.dispose(); boundary.value = new T.CanvasTexture(canvas);
    // Drape at the outside ground surface, with a narrow blend into the existing campus perimeter.
    group.position.y = .38;
  }
  function blend(target: T.MeshBasicMaterial, strength: number, photograph = false) {
    const previous = target.onBeforeCompile;
    target.onBeforeCompile = (shader, webgl) => {
      previous.call(target, shader, webgl);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec2 vVenueImagePosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vVenueImagePosition = (modelMatrix * vec4(transformed, 1.0)).xz;`);
      shader.fragmentShader = declarations + '\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.a *= ${photograph ? 'venueImageCoverage()' : `(1.0 - venueImageCoverage() * ${strength.toFixed(2)})`};
        if (diffuseColor.a < .005) discard;`);
    };
    target.customProgramCacheKey = () => `venue-map-photo-v1-${strength}-${photograph}`;
  }
  function load(): Promise<boolean> {
    if (imageReady.value) return Promise.resolve(true);
    if (pending) return pending;
    pending = (async () => {
      let texture: T.Texture | undefined, geometry: T.BufferGeometry | undefined;
      try {
        const response = await fetch(asset('geography/satellite/venue-map.json'), { signal });
        if (!response.ok) throw new Error(`Map imagery: HTTP ${response.status}`);
        const manifest: VenueMapImage = await response.json();
        const { u, v } = manifest.worldToImage, determinant = u[0] * v[1] - u[1] * v[0];
        if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) throw new Error('Invalid satellite registration');
        texture = await new T.TextureLoader().loadAsync(asset('geography/satellite/' + manifest.image));
        signal.throwIfAborted();
        texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        const world = (a: number, b: number) => [((a - u[2]) * v[1] - (b - v[2]) * u[1]) / determinant,
          -6.94, ((b - v[2]) * u[0] - (a - u[2]) * v[0]) / determinant];
        const [width, height] = manifest.size;
        geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute([
          ...world(0, 0), ...world(width, 0), ...world(width, height), ...world(0, height)], 3));
        geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
        geometry.setIndex([0, 2, 1, 0, 3, 2]);
        material = new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
        imageU.value.fromArray(u); imageV.value.fromArray(v); imageSize.value.fromArray(manifest.size); imageReady.value = 1;
        if (property) setProperty(property);
        blend(material, 1, true);
        const mesh = new T.Mesh(geometry, material); mesh.name = 'Bundled z18 imagery · feathered ground'; mesh.renderOrder = -2;
        group.add(mesh);
        return true;
      } catch (error) {
        texture?.dispose();
        geometry?.dispose(); material?.dispose(); material = undefined; imageReady.value = 0;
        if (!signal.aborted) console.warn('Map imagery unavailable; keeping OSM ground.', error);
        return false;
      } finally { pending = undefined; }
    })();
    return pending;
  }
  return { group, load, blend, setProperty, setOpacity: (opacity: number) => { if (material) material.opacity = opacity; } };
}
