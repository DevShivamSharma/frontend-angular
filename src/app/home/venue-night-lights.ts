import * as T from 'three';
import type { Gate9Light } from './venue-gate9';

/** Evening lighting for the Gate 9 approach, lane and office frontage.
 * Glow comes from the venue's own diffuser/glazing materials (every layer,
 * not only Gate 9); a bounded set of real lights near the gate lights the
 * ground. Nothing here runs per frame: the sun/moon toggle drives it.
 */
const GLOW = /diffuser|luminaire|streetlight|kiosk glazing|ENTRY sign|floodlight/i;
const REAL_LIGHT_BUDGET = 20;
const PRIORITY: Record<Gate9Light['kind'], number> = { flood: 0, kiosk: 1, lamp: 2, canopy: 3, cabin: 4 };
interface DayEmissive { color: number; intensity: number; }

export function createVenueNightLights(scene: T.Scene, root: T.Group, lights: Gate9Light[]) {
  const group = new T.Group();
  group.name = 'Gate 9 night lighting';
  const owned: T.Light[] = [];
  // Floodlights and the kiosk first, then street lamps; canopy lights fill the rest.
  const ranked = [...lights].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]).slice(0, REAL_LIGHT_BUDGET);
  for (const light of ranked) {
    const position = new T.Vector3(...light.position);
    // Intensities are calibrated against this renderer's sun/exposure (a 60 000 cd
    // test spot at 12 m read as a moderate pool), not taken from photometric data.
    if (light.kind === 'lamp' || light.kind === 'flood') {
      const flood = light.kind === 'flood';
      const spot = new T.SpotLight(flood ? 0xf4f1e2 : 0xffd9a0, flood ? 45000 : 10000, flood ? 80 : 36, flood ? .55 : 1.05, .7, 2);
      spot.position.copy(position);
      spot.target.position.copy(light.aim ? new T.Vector3(...light.aim) : position.clone().setY(0));
      group.add(spot, spot.target);
      owned.push(spot);
    } else {
      const point = new T.PointLight(0xffe2b8, light.kind === 'canopy' ? 1200 : light.kind === 'kiosk' ? 600 : 300,
        light.kind === 'canopy' ? 18 : 10, 2);
      point.position.copy(position);
      group.add(point);
      owned.push(point);
    }
  }
  // The group joins the scene only at night. The SSAO pass caches and restores
  // `visible` across its normal pass, so toggling that flag can be overwritten;
  // attaching and detaching the group cannot.
  let disposed = false;
  return {
    /** Re-run after an appearance change too: material.copy() restores the day values. */
    setDaylight(daylight: boolean) {
      if (disposed) return;
      if (daylight) group.removeFromParent(); else if (group.parent !== scene) scene.add(group);
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
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const light of owned) light.dispose();
      group.clear();
    },
  };
}
