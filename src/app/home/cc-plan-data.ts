/** Coordinates traced from the supplied raster plans (inspection render coordinates).
 * No dimension scale was supplied. Runtime registration uses the incumbent CC floor plates.
 * Room IDs are local visual-model identifiers, never backend booking IDs. */
export type PlanPoint = [number, number];
export type RoomKind =
  | 'meeting'
  | 'boardroom'
  | 'banquet'
  | 'theatre'
  | 'lounge'
  | 'service'
  | 'wc'
  | 'lift'
  | 'stair'
  | 'garden'
  | 'foyer'
  | 'g20';
export interface CCRoom {
  id: string;
  label: string;
  kind: RoomKind;
  rect: [number, number, number, number];
  door?: 'n' | 's' | 'e' | 'w';
  note?: string;
}
export interface CCPlan {
  level: number;
  label: string;
  source: string;
  sha256: string;
  bounds: [number, number, number, number];
  outline: PlanPoint[];
  rooms: CCRoom[];
  route: PlanPoint[];
  entry: PlanPoint;
  fan: { label: string; center: PlanPoint; radius: PlanPoint; tiered: boolean };
}
const room = (
  id: string,
  label: string,
  kind: RoomKind,
  rect: CCRoom['rect'],
  door: CCRoom['door'] = 's',
  note?: string,
): CCRoom => ({ id, label, kind, rect, door, note });
const rect = (
  id: string,
  label: string,
  kind: RoomKind,
  x: number,
  z: number,
  w: number,
  d: number,
  door: CCRoom['door'] = 's',
) => room(id, label, kind, [x, z, x + w, z + d], door);
export const CC_PLANS: CCPlan[] = [
  {
    level: 1,
    label: 'Ground floor',
    source: 'CC-level-1.pdf',
    sha256: 'cbddbd59a82f9ae8b5b7fbe7384fd8bf1d1e87d3042de7e54f9359d517f46022',
    bounds: [180, 295, 1190, 1465],
    outline: [
      [685, 295],
      [850, 335],
      [970, 455],
      [1055, 615],
      [1186, 615],
      [1180, 900],
      [1090, 1120],
      [1000, 1320],
      [895, 1415],
      [755, 1465],
      [615, 1465],
      [480, 1400],
      [380, 1280],
      [295, 1180],
      [220, 970],
      [180, 780],
      [188, 600],
      [312, 615],
      [400, 440],
      [530, 335],
    ],
    entry: [365, 775],
    route: [
      [365, 775],
      [365, 855],
      [564, 855],
      [564, 1080],
      [564, 1280],
      [793, 1280],
      [793, 1090],
      [793, 856],
      [983, 856],
      [1000, 777],
    ],
    fan: { label: 'CC amphitheatre', center: [685, 648], radius: [273, 267], tiered: true },
    rooms: [
      rect('mr4', 'MR 4', 'boardroom', 448, 700, 44, 95),
      rect('mr3', 'MR 3', 'boardroom', 495, 700, 44, 95),
      rect('pmr-pbl', 'PMR / PBL', 'boardroom', 542, 680, 65, 112),
      rect('pmr21', 'PMR 21', 'boardroom', 612, 675, 140, 77),
      rect('br20', 'BR 20', 'lounge', 574, 797, 35, 28),
      rect('ppf26', 'PPF 26', 'lounge', 613, 757, 120, 65),
      rect('pwl22', 'PWL 22', 'lounge', 738, 776, 48, 48),
      rect('pdr23', 'PDR 23', 'boardroom', 790, 744, 45, 80),
      rect('mr2', 'MR 2', 'boardroom', 840, 700, 44, 96),
      rect('mr1', 'MR 1', 'boardroom', 888, 700, 44, 96),
      rect('mr16-north', 'MR 16 · north', 'boardroom', 396, 894, 44, 78, 'n'),
      rect('mr19', 'MR 19', 'banquet', 445, 894, 93, 152, 'e'),
      rect('mr18', 'MR 18', 'theatre', 445, 1116, 93, 150, 'e'),
      rect('mr5', 'MR 5', 'boardroom', 930, 894, 45, 78, 'n'),
      rect('mr6', 'MR 6', 'banquet', 831, 894, 94, 152, 'w'),
      rect('mr7', 'MR 7', 'theatre', 831, 1120, 94, 146, 'w'),
      rect('mr14', 'MR 14', 'boardroom', 593, 970, 49, 74, 'n'),
      rect('mr13', 'MR 13', 'banquet', 645, 970, 42, 74, 'n'),
      rect('mr12', 'MR 12', 'meeting', 690, 970, 42, 74, 'n'),
      rect('mr11', 'MR 11', 'theatre', 735, 970, 43, 74, 'n'),
      rect('mr15', 'MR 15', 'theatre', 593, 1049, 82, 73, 'w'),
      rect('mr10', 'MR 10', 'theatre', 688, 1049, 90, 73, 'e'),
      rect('mr16-central', 'MR 16 · central', 'theatre', 593, 1127, 82, 69, 'w'),
      rect('mr9', 'MR 9', 'theatre', 688, 1127, 90, 69, 'e'),
      rect('mr17', 'MR 17', 'banquet', 593, 1200, 91, 67, 's'),
      rect('mr8', 'MR 8', 'banquet', 689, 1200, 89, 67, 's'),
      rect('reception-general', '31 · General reception', 'foyer', 312, 673, 120, 152),
      rect('reception-vip', '28 · VIP reception', 'foyer', 944, 674, 113, 152),
      rect('growth', 'Growth courtyard', 'garden', 256, 721, 67, 161),
      rect('culture', 'Cultural courtyard', 'garden', 1048, 721, 61, 159),
      rect('drivers', 'Drivers lounge', 'lounge', 1106, 836, 49, 152, 'w'),
      rect('ahu-nw', 'AHU · north west', 'service', 396, 976, 42, 70),
      rect('ahu-sw', 'AHU · south west', 'service', 397, 1115, 41, 83),
      rect('ahu-se', 'AHU · south east', 'service', 934, 1116, 42, 82),
      rect('wc-nw', 'Toilets · north west', 'wc', 189, 524, 69, 67, 's'),
      rect('wc-ne', 'Toilets · north east', 'wc', 1114, 524, 69, 67, 's'),
      rect('wc-w', 'Toilets · west', 'wc', 317, 913, 57, 53, 'e'),
      rect('wc-e', 'Toilets · east', 'wc', 1000, 974, 65, 68, 'w'),
      rect('stairs-nw', 'Stairs · north west', 'stair', 402, 683, 37, 87, 's'),
      rect('stairs-ne', 'Stairs · north east', 'stair', 935, 683, 35, 87, 's'),
      rect('stairs-sw', 'Stairs · south west', 'stair', 387, 1291, 36, 38, 'n'),
      rect('stairs-se', 'Stairs · south east', 'stair', 790, 1291, 43, 38, 'n'),
      rect('lift-w', 'Passenger lifts · west', 'lift', 443, 1291, 64, 37, 'n'),
      rect('lift-e', 'Passenger lifts · east', 'lift', 846, 1291, 67, 37, 'n'),
      rect('cargo-w', 'Cargo lift · west', 'lift', 622, 1334, 40, 72, 'n'),
      rect('cargo-e', 'Cargo lift · east', 'lift', 705, 1334, 39, 72, 'n'),
    ],
  },
  {
    level: 2,
    label: 'Podium level',
    source: 'CC-level-2.pdf',
    sha256: '69135c0aa0b8f93fd677bbb10557cc5fb7e3f3ac6babe63a304cdd0a5cc059ad',
    bounds: [260, 232, 1150, 1585],
    outline: [
      [705, 232],
      [885, 275],
      [1020, 412],
      [1120, 633],
      [1150, 892],
      [1105, 1170],
      [1000, 1370],
      [885, 1515],
      [752, 1583],
      [650, 1583],
      [500, 1515],
      [394, 1370],
      [298, 1155],
      [260, 892],
      [289, 620],
      [383, 408],
      [526, 278],
    ],
    entry: [700, 1155],
    route: [
      [700, 1155],
      [700, 1045],
      [705, 961],
      [705, 1045],
      [705, 1115],
      [945, 1115],
      [1035, 1115],
      [1035, 1184],
      [947, 1184],
      [704, 1184],
      [481, 1184],
      [331, 1184],
      [331, 1115],
    ],
    fan: {
      label: 'CC amphitheatre / special lounge',
      center: [705, 858],
      radius: [236, 235],
      tiered: true,
    },
    rooms: [
      rect('auditorium2', 'Auditorium 2', 'theatre', 493, 885, 166, 191, 's'),
      rect('auditorium1', 'Auditorium 1', 'theatre', 753, 885, 164, 184, 's'),
      rect('g20', 'G20 meeting room', 'g20', 497, 1219, 242, 189, 'n'),
      rect('leaders', 'Leaders lounge', 'banquet', 748, 1221, 168, 164, 'n'),
      rect('prefunction1', 'Prefunction 1', 'foyer', 497, 1115, 418, 94),
      rect('prefunction2', 'Prefunction 2', 'foyer', 666, 886, 80, 195),
      rect('court-west', 'Courtyard · public side', 'garden', 320, 923, 96, 153),
      rect('court-east', 'Courtyard · VVIP side', 'garden', 997, 923, 90, 153),
      rect('lobby-west', 'Public reception', 'foyer', 295, 1100, 186, 60),
      rect('lobby-east', 'VVIP reception', 'foyer', 940, 1100, 183, 60),
      rect('special', 'Special lounge', 'lounge', 648, 608, 112, 44, 's'),
      rect('vvip', 'VVIP lounge / presidential lobby', 'lounge', 964, 790, 58, 84, 'w'),
      rect('office-w', 'Organiser office · west', 'service', 426, 1198, 55, 46, 'e'),
      rect('office-e', 'Organiser office · east', 'service', 940, 1198, 46, 46, 'w'),
      rect('medical', 'Medical room', 'service', 940, 1280, 45, 68, 'w'),
      rect('wc-w', 'Toilets · west', 'wc', 335, 1200, 84, 72, 'e'),
      rect('wc-e', 'Toilets · east', 'wc', 991, 1200, 87, 80, 'w'),
      rect('stairs-nw', 'Stairs · north west', 'stair', 458, 910, 33, 56, 's'),
      rect('stairs-ne', 'Stairs · north east', 'stair', 921, 910, 31, 56, 's'),
      rect('stairs-sw', 'Stairs · south west', 'stair', 434, 1358, 48, 45, 'e'),
      rect('stairs-se', 'Stairs · south east', 'stair', 940, 1358, 43, 45, 'w'),
      rect('lift-w', 'Passenger lifts · west', 'lift', 490, 1422, 107, 40, 'n'),
      rect('lift-e', 'Passenger lifts · east', 'lift', 778, 1422, 107, 40, 'n'),
      rect('cargo-w', 'Cargo lift · west', 'lift', 649, 1470, 42, 63, 'n'),
      rect('cargo-e', 'Cargo lift · east', 'lift', 718, 1470, 44, 63, 'n'),
    ],
  },
  {
    level: 3,
    label: 'Plenary level',
    source: 'CC-level-3.pdf',
    sha256: '415aaa24f920afac0825a28369517bcd62ef97f22018bd2987d44093cf664169',
    bounds: [210, 356, 1120, 1575],
    outline: [
      [665, 356],
      [850, 405],
      [1000, 553],
      [1100, 766],
      [1120, 975],
      [1070, 1230],
      [961, 1400],
      [820, 1525],
      [715, 1575],
      [614, 1575],
      [467, 1520],
      [337, 1370],
      [250, 1160],
      [210, 945],
      [230, 734],
      [330, 529],
      [488, 405],
    ],
    entry: [670, 1096],
    route: [
      [670, 1096],
      [670, 971],
      [670, 893],
      [670, 877],
      [670, 893],
      [670, 1096],
      [670, 1262],
      [670, 1096],
    ],
    fan: { label: 'Plenary hall', center: [665, 850], radius: [233, 236], tiered: true },
    rooms: [
      rect('multi-function', 'Multi-function hall', 'theatre', 455, 916, 430, 479, 'n'),
      rect('prefunction-w', 'Prefunction · Exhibition Complex side', 'foyer', 345, 1050, 99, 285),
      rect('prefunction-e', 'Prefunction · Mathura Road side', 'foyer', 899, 1050, 89, 285),
      rect('special', 'Special lobby', 'lounge', 634, 565, 64, 42, 's'),
      rect('vvip', 'VVIP / special lounge', 'lounge', 947, 756, 56, 85, 'w'),
      rect('green-w', 'Green room · west', 'lounge', 398, 1330, 52, 35, 'e'),
      rect('green-e', 'Green room · east', 'lounge', 894, 1330, 47, 35, 'w'),
      rect('stairs-nw', 'Stairs · north west', 'stair', 412, 867, 42, 67, 's'),
      rect('stairs-ne', 'Stairs · north east', 'stair', 884, 867, 42, 67, 's'),
      rect('stairs-sw', 'Stairs · south west', 'stair', 411, 1369, 43, 32, 's'),
      rect('stairs-se', 'Stairs · south east', 'stair', 888, 1369, 49, 32, 's'),
      rect('wc-sw', 'Toilets · south west', 'wc', 451, 1470, 91, 64, 'n'),
      rect('wc-se', 'Toilets · south east', 'wc', 797, 1470, 91, 64, 'n'),
      rect('lift-w', 'Passenger lifts · west', 'lift', 465, 1413, 101, 42, 's'),
      rect('lift-e', 'Passenger lifts · east', 'lift', 776, 1413, 99, 42, 's'),
      rect('cargo-w', 'Cargo lift · west', 'lift', 616, 1461, 47, 63, 'n'),
      rect('cargo-e', 'Cargo lift · east', 'lift', 679, 1461, 48, 63, 'n'),
    ],
  },
];
