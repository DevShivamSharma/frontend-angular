import * as T from 'three';
import type { Gate9Light } from './venue-gate9';

/** Evening lighting for the Gate 9 approach, lane and office frontage.
 * Glow comes from the venue's own diffuser/glazing materials (every layer,
 * not only Gate 9). A small fixed pool of real lights follows the camera to
 * the nearest lamps: the pool size never changes, so materials compile their
 * lit shader once, and a walking visitor is not paying for twenty lights.
 */
const GLOW = /diffuser|luminaire|streetlight|kiosk glazing|ENTRY sign|floodlight/i;
const SPOT_POOL = 6, POINT_POOL = 3;
const REPICK_DISTANCE = 6;
interface DayEmissive { color: number; intensity: number; }
// Intensities are calibrated against this renderer's sun/exposure (a 60 000 cd
// test spot at 12 m read as a moderate pool), not taken from photometric data.
const SPOT: Record<'lamp' | 'flood', { color: number; intensity: number; distance: number; angle: number }> = {
  lamp: { color: 0xffd9a0, intensity: 10000, distance: 36, angle: 1.05 },
  flood: { color: 0xf4f1e2, intensity: 45000, distance: 80, angle: .55 },
};
const POINT: Record<'canopy' | 'kiosk' | 'cabin', { intensity: number; distance: number }> = {
  canopy: { intensity: 1200, distance: 18 }, kiosk: { intensity: 600, distance: 10 }, cabin: { intensity: 300, distance: 10 },
};

export function createVenueNightLights(scene: T.Scene, root: T.Group, lights: Gate9Light[]) {
  const group = new T.Group();
  group.name = 'Gate 9 night lighting';
  const spots = Array.from({ length: SPOT_POOL }, () => new T.SpotLight(0xffffff, 0, 1, 1, .7, 2));
  const points = Array.from({ length: POINT_POOL }, () => new T.PointLight(0xffe2b8, 0, 1, 2));
  for (const spot of spots) group.add(spot, spot.target);
  for (const point of points) group.add(point);
  const spotSources = lights.filter(l => l.kind === 'lamp' || l.kind === 'flood');
  const pointSources = lights.filter(l => l.kind === 'canopy' || l.kind === 'kiosk' || l.kind === 'cabin');
  const lastPick = new T.Vector3(Infinity, Infinity, Infinity);
  let disposed = false, attached = false;

  function nearest<L extends Gate9Light>(sources: L[], at: T.Vector3, count: number): L[] {
    return [...sources].sort((a, b) =>
      at.distanceToSquared(new T.Vector3(...a.position)) - at.distanceToSquared(new T.Vector3(...b.position))).slice(0, count);
  }
  function assign(at: T.Vector3) {
    nearest(spotSources, at, SPOT_POOL).forEach((source, i) => {
      const spot = spots[i], preset = SPOT[source.kind as 'lamp' | 'flood'];
      spot.color.setHex(preset.color); spot.intensity = preset.intensity;
      spot.distance = preset.distance; spot.angle = preset.angle;
      spot.position.set(...source.position);
      spot.target.position.copy(source.aim ? new T.Vector3(...source.aim) : spot.position.clone().setY(0));
    });
    for (let i = spotSources.length; i < SPOT_POOL; i++) spots[i].intensity = 0;
    nearest(pointSources, at, POINT_POOL).forEach((source, i) => {
      const point = points[i], preset = POINT[source.kind as 'canopy' | 'kiosk' | 'cabin'];
      point.intensity = preset.intensity; point.distance = preset.distance;
      point.position.set(...source.position);
    });
    for (let i = pointSources.length; i < POINT_POOL; i++) points[i].intensity = 0;
    lastPick.copy(at);
  }
  return {
    /** Re-run after an appearance change too: material.copy() restores the day values. */
    setDaylight(daylight: boolean) {
      if (disposed) return;
      // The group joins the scene only at night. The SSAO pass caches and restores
      // `visible` across its normal pass, so toggling that flag can be overwritten;
      // attaching and detaching the group cannot.
      if (daylight) { group.removeFromParent(); attached = false; }
      else if (!attached) { scene.add(group); attached = true; lastPick.set(Infinity, Infinity, Infinity); }
      root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof T.MeshStandardMaterial) || !GLOW.test(material.name)) continue;
          const sign = /ENTRY sign/i.test(material.name);
          const day: DayEmissive = material.userData['dayEmissive'] ??= { color: material.emissive.getHex(), intensity: material.emissiveIntensity };
          if (daylight) { material.emissive.setHex(day.color); material.emissiveIntensity = day.intensity; }
          else { material.emissive.setHex(sign ? 0xffffff : 0xffcf8a); material.emissiveIntensity = sign ? 1.6 : 6; }
        }
      });
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
      group.clear();
    },
  };
}
