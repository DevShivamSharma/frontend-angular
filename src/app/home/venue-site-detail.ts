import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface SiteRegistration {
  affine: { x: [number, number, number]; z: [number, number, number] };
  referenceExtent: [number, number];
  status: string;
  mapMask: { polygons: [number, number][][]; roads: { points: [number, number][]; width: number }[]; bounds?: [number, number, number, number] };
  roadNetwork?: { fadeEnds: [number, number][] };
  walkways?: { paths: { id: string; type: 'service' | 'path'; width: number; points: [number, number][] }[] };
}

// Model campus drives that the z18 satellite shows in the wrong place (16 to 184 m
// from any visible carriageway); the traced service roads in this layer replace them.
// The Gate 3, Gate 4 and Gate 5B approaches match the satellite and stay.
const SUPERSEDED_DRIVES = ['Eastern perimeter service drive', 'Gate 10 north campus approach',
  'Gate 11 forecourt connector', 'Hall 1 rear service drive', 'Hall 6 north approach',
  'Hall 6 south and Gate 1 approach', 'Hall 12A east service link', 'Hall 14 to exhibition plaza drive',
].map(name => `PHOTO_PATH_${name.replaceAll(' ', '_')}`);

/** Separate Blender-authored surroundings. The original hall asset is never edited. */
export async function prepareVenueSiteDetail(root: T.Group, asset: (path: string) => string,
  signal: AbortSignal): Promise<SiteRegistration> {
  const [modelResponse, registrationResponse] = await Promise.all([
    fetch(asset('venue-site-detail.glb'), { signal }),
    fetch(asset('venue-site-detail.json'), { signal }),
  ]);
  if (!modelResponse.ok || !registrationResponse.ok) throw new Error('Venue surroundings unavailable');
  const [bytes, registration] = await Promise.all([
    modelResponse.arrayBuffer(), registrationResponse.json() as Promise<SiteRegistration>,
  ]);
  signal.throwIfAborted();
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  // Attach immediately so the viewer owns disposal even if navigation aborts now.
  gltf.scene.name = 'SITE_REFERENCE surroundings and property planting';
  gltf.scene.userData['referenceStatus'] = registration.status;
  gltf.scene.traverse(object => {
    if (object instanceof T.Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.userData['siteDetail'] = true;
        material.userData['siteRoad'] = material.name.startsWith('SITE_ROAD ');
      }
    }
  });
  root.add(gltf.scene);
  signal.throwIfAborted();
  root.traverse(object => {
    if (object.name === 'SUPREME_COURT_METRO_STN' || object.name.startsWith('PHOTO_ADMIN')) {
      object.visible = false;
      object.userData['supersededBySiteReference'] = true;
    }
    // Drives and their edge inlays; flag every mesh so batching cannot merge one back into view.
    if (SUPERSEDED_DRIVES.some(name => object.name.startsWith(name))) object.traverse(child => {
      child.visible = false;
      child.userData['supersededBySiteReference'] = true;
    });
  });
  return registration;
}

/** Roads cross the photo boundary continuously and taper only at outer open ends. */
export function prepareSiteDetailRendering(root: T.Group, registration: SiteRegistration) {
  const { x, z } = registration.affine, d = x[0] * z[1] - x[1] * z[0];
  const u = new T.Vector3(z[1] / d, -x[1] / d, (x[1] * z[2] - z[1] * x[2]) / d);
  const v = new T.Vector3(-z[0] / d, x[0] / d, (z[0] * x[2] - x[0] * z[2]) / d);
  const ends = (registration.roadNetwork?.fadeEnds ?? []).map(p => new T.Vector2(...p));
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material.userData['siteDetail']) continue;
      const road = !!material.userData['siteRoad'];
      // Continuous alpha keeps the crop transition free of visible screen-door dots.
      // Retain depth writes so opaque parts of the static batches occlude correctly.
      material.transparent = true;
      material.onBeforeCompile = (shader: Parameters<T.Material['onBeforeCompile']>[0]) => {
        shader.uniforms['siteU'] = { value: u }; shader.uniforms['siteV'] = { value: v };
        if (road && ends.length) shader.uniforms['siteRoadEnds'] = { value: ends };
        shader.vertexShader = 'varying vec2 vSitePosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vSitePosition = (modelMatrix * vec4(transformed, 1.0)).xz;`);
        shader.fragmentShader = 'varying vec2 vSitePosition; uniform vec3 siteU; uniform vec3 siteV;\n' + shader.fragmentShader;
        if (road && ends.length) shader.fragmentShader = `uniform vec2 siteRoadEnds[${ends.length}];\n` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec3 sitePoint = vec3(vSitePosition, 1.0);
          vec2 sitePixel = vec2(dot(siteU, sitePoint), dot(siteV, sitePoint));
          float edge = min(min(sitePixel.x, ${registration.referenceExtent[0]}.0 - sitePixel.x), min(sitePixel.y, ${registration.referenceExtent[1]}.0 - sitePixel.y));
          float coverage = smoothstep(-25.0, 65.0, edge);
          ${road ? `coverage = 1.0; ${ends.length ? `for (int i = 0; i < ${ends.length}; i++) coverage = min(coverage, smoothstep(0.0, 65.0, distance(vSitePosition, siteRoadEnds[i])));` : ''}` : ''}
          diffuseColor.a *= coverage;
          if (diffuseColor.a < 0.005) discard;`);
      };
      material.customProgramCacheKey = () => `venue-site-edge-v3-${road}-${ends.length}`;
      material.needsUpdate = true;
    }
  });
}
