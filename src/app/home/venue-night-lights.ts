import * as T from 'three';
import { isVenueEmitter, VenueLightSource } from './venue-light-sources';
import { createVenueLightPools } from './venue-light-pools';

/** Evening lighting across the venue, using Gate 9's warm-light treatment.
 * Glow comes from the venue's own diffuser/glazing materials (every layer,
 * not only Gate 9). A small fixed pool of real lights follows the camera to
 * the nearest lamps: the pool size never changes, so materials compile their
 * lit shader once, and a walking visitor is not paying for twenty lights.
 */
const SPOT_POOL = 6, POINT_POOL = 3;
const REPICK_DISTANCE = 6;
interface DayEmissive { color: number; intensity: number; }
// Intensities are calibrated against this renderer's sun/exposure (a 60 000 cd
// test spot at 12 m read as a moderate pool), not taken from photometric data.
const SPOT = {
  lamp: { color: 0xffd9a0, intensity: 10000, distance: 36, angle: 1.05 },
  flood: { color: 0xf4f1e2, intensity: 45000, distance: 80, angle: .55 },
  entrance: { color: 0xffdfaf, intensity: 2200, distance: 19, angle: 1.1 },
};
const POINT = {
  canopy: { intensity: 1200, distance: 18 }, kiosk: { intensity: 600, distance: 10 }, cabin: { intensity: 300, distance: 10 },
  bollard: { intensity: 75, distance: 6 },
};

export function createVenueNightLights(scene: T.Scene, root: T.Group, lights: VenueLightSource[]) {
  const group = new T.Group();
  group.name = 'Venue night lighting';
  group.userData['sourceCount'] = lights.length;
  const pools = createVenueLightPools(lights); group.add(pools.mesh);
  const spots = Array.from({ length: SPOT_POOL }, () => new T.SpotLight(0xffffff, 0, 1, 1, .7, 2));
  const points = Array.from({ length: POINT_POOL }, () => new T.PointLight(0xffe2b8, 0, 1, 2));
  for (const spot of spots) group.add(spot, spot.target);
  for (const point of points) group.add(point);
  const spotSources = lights.filter(l => l.kind in SPOT);
  const pointSources = lights.filter(l => l.kind in POINT);
  const lastPick = new T.Vector3(Infinity, Infinity, Infinity);
  const dayMaterials = new Map<T.MeshStandardMaterial, DayEmissive>();
  let disposed = false, attached = false;

  function nearest(sources: VenueLightSource[], at: T.Vector3, count: number): VenueLightSource[] {
    // Keep the tiny best-N list; no Vector3 allocation or full sort per frame.
    const best: { source: VenueLightSource; distance: number }[] = [];
    for (const source of sources) {
      const [x, y, z] = source.position;
      const distance = (at.x - x) ** 2 + (at.y - y) ** 2 + (at.z - z) ** 2;
      if (best.length === count && distance >= best[count - 1].distance) continue;
      const index = best.findIndex(b => distance < b.distance);
      best.splice(index < 0 ? best.length : index, 0, { source, distance });
      if (best.length > count) best.pop();
    }
    return best.map(b => b.source);
  }
  function assign(at: T.Vector3) {
    nearest(spotSources, at, SPOT_POOL).forEach((source, i) => {
      const spot = spots[i], preset = SPOT[source.kind as keyof typeof SPOT];
      const campus = !source.name.startsWith('Gate 9 ');
      spot.color.setHex(preset.color); spot.intensity = preset.intensity * (campus ? 2.2 : 1);
      spot.distance = preset.distance * (campus ? 1.3 : 1); spot.angle = preset.angle;
      spot.position.set(...source.position);
      spot.target.position.set(...(source.aim ?? source.ground ?? [source.position[0], 0, source.position[2]]));
    });
    for (let i = spotSources.length; i < SPOT_POOL; i++) spots[i].intensity = 0;
    nearest(pointSources, at, POINT_POOL).forEach((source, i) => {
      const point = points[i], preset = POINT[source.kind as keyof typeof POINT];
      const campus = !source.name.startsWith('Gate 9 ');
      point.intensity = preset.intensity * (campus ? 2.2 : 1);
      point.distance = preset.distance * (campus ? 1.3 : 1);
      point.position.set(...source.position);
    });
    for (let i = pointSources.length; i < POINT_POOL; i++) points[i].intensity = 0;
    lastPick.copy(at);
  }
  function refreshMaterials() {
    dayMaterials.clear();
    root.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof T.MeshStandardMaterial && isVenueEmitter(material))
          dayMaterials.set(material, { color: material.emissive.getHex(), intensity: material.emissiveIntensity });
      }
    });
  }
  refreshMaterials();
  return {
    /** Call after appearance.apply(), while materials contain their new day values. */
    refreshMaterials,
    setDaylight(daylight: boolean) {
      if (disposed) return;
      // The group joins the scene only at night. The SSAO pass caches and restores
      // `visible` across its normal pass, so toggling that flag can be overwritten;
      // attaching and detaching the group cannot.
      if (daylight) { group.removeFromParent(); attached = false; }
      else if (!attached) { scene.add(group); attached = true; lastPick.set(Infinity, Infinity, Infinity); }
      for (const [material, day] of dayMaterials) {
          const sign = /ENTRY sign/i.test(material.name), edge = /recessed line lights/i.test(material.name);
          if (daylight) { material.emissive.setHex(day.color); material.emissiveIntensity = day.intensity; }
          else { material.emissive.setHex(sign ? 0xffffff : 0xffcf8a); material.emissiveIntensity = sign ? 1.6 : edge ? 2.5 : 6; }
      }
    },
    /** Moves the pool to the lamps nearest the camera. Returns true when lights moved. */
    update(at: T.Vector3): boolean {
      if (disposed || !attached || at.distanceTo(lastPick) < REPICK_DISTANCE) return false;
      assign(at);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const light of [...spots, ...points]) light.dispose();
      for (const [material, day] of dayMaterials) { material.emissive.setHex(day.color); material.emissiveIntensity = day.intensity; }
      dayMaterials.clear(); pools.dispose();
      group.clear();
    },
  };
}
