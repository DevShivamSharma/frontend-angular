import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Hall } from '../planner/models/hall.model';
import { amenityInfo } from './amenity-kinds';

const GROUP_COLOR: Record<string, string> = {
  Toilets: '#5b8def',
  'Lifts & stairs': '#2f9e8f',
  'Entries & exits': '#ea0a51',
  Facilities: '#0b51a3'
};

/** A small plan of a hall: its outline and where its facilities are. Decorative summary. */
@Component({
  selector: 'app-hall-thumbnail',
  template: `
    <svg [attr.viewBox]="view().box" preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="'Plan of ' + hall().name">
      <path [attr.d]="view().outline" class="outline" [attr.stroke-width]="view().stroke" />
      @for (dot of view().dots; track $index) {
        <circle [attr.cx]="dot.x" [attr.cy]="dot.z" [attr.r]="view().dot" [attr.fill]="dot.color" />
      }
    </svg>
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; overflow: hidden; }
    svg { display: block; width: 100%; height: 100%; overflow: hidden; }
    .outline { fill: #fff; stroke: #3d0707; stroke-linejoin: round; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HallThumbnailComponent {
  readonly hall = input.required<Hall>();

  readonly view = computed(() => {
    const hall = this.hall();
    const points = hall.boundary?.length
      ? hall.boundary
      : [
          { x: -hall.width / 2, z: -hall.length / 2 },
          { x: hall.width / 2, z: -hall.length / 2 },
          { x: hall.width / 2, z: hall.length / 2 },
          { x: -hall.width / 2, z: hall.length / 2 }
        ];
    const xs = points.map(p => p.x);
    const zs = points.map(p => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const size = Math.max(maxX - minX, maxZ - minZ, 1);
    const pad = size * 0.06;
    const inside = (x: number, z: number) => x >= minX - pad && x <= maxX + pad && z >= minZ - pad && z <= maxZ + pad;
    return {
      box: `${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}`,
      outline: 'M' + points.map(p => `${p.x} ${p.z}`).join('L') + 'Z',
      stroke: size * 0.012,
      dot: size * 0.018,
      dots: (hall.amenities ?? [])
        .filter(a => inside(a.position.x, a.position.z))
        .map(a => ({ x: a.position.x, z: a.position.z, color: GROUP_COLOR[amenityInfo(a.kind).group] }))
    };
  });
}
