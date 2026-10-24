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
