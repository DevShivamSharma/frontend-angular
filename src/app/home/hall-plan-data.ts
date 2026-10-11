/** Traced from the supplied ITPO standard-layout PDFs, dated 29 May 2026.
 * Coordinates use a 1888px-wide page (not guessed building metres). Registration
 * preserves proportions and records the fit to the incumbent exterior shell.
 * Heights and unlabelled doorway widths are visualization assumptions. */
export type PlanPoint = [number, number];
export type PlanRect = [number, number, number, number];
export interface PlanRoom {
  label: string; rect: PlanRect;
  kind: 'toilet' | 'lift' | 'stair' | 'service' | 'room';
  door: 'left' | 'right' | 'top' | 'bottom';
}
export interface HallPlan {
  id: string; source: string; floor: string; metresPerPixel: number;
  outline: PlanPoint[]; exhibition: PlanPoint[];
  entry: PlanPoint; inward: PlanPoint; route: PlanPoint[];
  columns: PlanPoint[]; columnSize: number;
  rooms: PlanRoom[]; foyer: PlanRect;
  curtains: [PlanPoint, PlanPoint][];
  /** Open stall allocation outlines are floor markings, not permanent rooms. */
  allocations: PlanRect[];
}
const room = (label: string, rect: PlanRect, kind: PlanRoom['kind'], door: PlanRoom['door']): PlanRoom => ({label, rect, kind, door});
const curve14: PlanPoint[] = [[1260,280],[1080,264],[900,258],[720,270],[540,310],[390,390],[280,495],[224,620],
  [211,735],[230,875],[280,975],[390,1075],[545,1143],[725,1183],[920,1190],[1100,1163],[1260,1125]];
const plan14: HallPlan = {
  id:'hall14',source:'hall14.pdf',floor:'Ground floor',metresPerPixel:95/(1258-204),
  outline:[[225,205],[1274,205],[1440,323],[1538,455],[1460,550],[1418,593],[1418,873],[1538,995],
    [1460,1092],[1310,1195],[1120,1260],[900,1282],[645,1260],[445,1200],[268,1080],[155,940],[108,760],[127,573],[210,421]],
  exhibition:curve14,entry:[1418,735],inward:[1160,735],foyer:[1285,480,1418,980],
  route:[[1350,735],[1200,770],[1020,820],[700,820],[430,825],[430,550],[920,530],[1180,610],[1200,770],[1350,735]],
  columns:[335,531,714,908,1081].map(x=>[x,730]),columnSize:2.2,
  rooms:[room('Room 14G-F3',[1304,415,1360,466],'room','bottom'),room('Room 14G-F4',[1363,415,1425,466],'room','bottom'),
    room('Room 14G-F2',[1304,995,1360,1045],'room','top'),room('Room 14G-F1',[1363,995,1425,1045],'room','top'),
    room('Female toilets',[1305,280,1386,377],'toilet','left'),room('Male toilets',[1305,380,1435,414],'toilet','bottom'),
    room('Male toilets',[1305,1054,1410,1100],'toilet','top'),room('Female toilets',[1305,1104,1385,1185],'toilet','left'),
    room('Male toilets',[139,608,207,760],'toilet','right'),room('Female toilets',[152,785,221,921],'toilet','right'),
    room('Cargo lift',[265,215,342,258],'lift','right'),room('Cargo lift',[265,269,342,314],'lift','right'),
    room('Lift lobby',[484,214,593,283],'lift','bottom'),room('Electrical room',[1000,207,1082,258],'service','bottom'),
    room('Stair',[598,207,704,270],'stair','bottom'),room('Stair',[1090,207,1186,270],'stair','bottom'),
    room('Stair',[710,1201,792,1263],'stair','top'),room('Stair',[1145,1163,1228,1218],'stair','top')],
  curtains:[[[428,419],[428,1110]],[[714,277],[714,1187]],[[990,278],[990,1180]]],
  allocations:[[512,325,700,413],[757,292,834,412],[1011,302,1213,411],[323,448,555,647],
    [578,448,1203,647],[319,679,656,802],[746,680,1203,1034],[287,837,426,959],[456,837,555,1035],
    [578,837,723,1035],[466,1069,693,1139],[746,1069,975,1149],[1005,1069,1195,1126]]
};
const plan1: HallPlan = {
  id:'hall1',source:'hall1.pdf',floor:'First floor reference; elevation unverified',metresPerPixel:23.5/(697-441),
  outline:[[163,470],[290,318],[425,220],[1451,220],[1451,355],[1520,480],[1553,660],[1560,822],
    [1510,995],[1400,1124],[1210,1230],[990,1270],[733,1262],[525,1207],[315,1098],[167,1000],[234,918],[272,865],[272,576]],
  exhibition:[[451,341],[605,305],[800,295],[1040,300],[1230,340],[1360,420],[1430,530],[1460,675],
    [1452,843],[1372,990],[1220,1095],[1045,1150],[830,1168],[625,1150],[451,1118]],
  entry:[272,735],inward:[550,735],foyer:[272,488,410,978],
  route:[[348,735],[500,770],[695,820],[1080,820],[1240,720],[1050,565],[745,550],[530,610],[500,770],[348,735]],
  columns:[612,793,971,1150,1333].map(x=>[x,735]),columnSize:1.2,
  rooms:[room('Room 1F-F1',[279,427,353,476],'room','bottom'),room('Room 1F-F2',[357,427,395,476],'room','bottom'),
    room('Room 1F-F3',[279,995,353,1040],'room','top'),room('Room 1F-F4',[357,995,395,1040],'room','top'),
    room('Female toilets',[334,291,391,383],'toilet','right'),room('Male toilets',[280,385,391,421],'toilet','bottom'),
    room('Male toilets',[286,1048,390,1085],'toilet','top'),room('Female toilets',[336,1088,392,1175],'toilet','right'),
    room('Male toilets',[1460,639,1537,780],'toilet','left'),room('Female toilets',[1429,794,1500,917],'toilet','left'),
    room('Lift lobby',[433,227,502,282],'lift','bottom'),room('Stair',[511,226,605,281],'stair','bottom'),
    room('Electrical room',[613,226,695,281],'service','bottom'),room('Stair',[984,226,1083,281],'stair','bottom'),
    room('Lift lobby',[1094,226,1196,302],'lift','bottom'),room('Cargo lift',[1339,227,1417,272],'lift','left'),
    room('Cargo lift',[1339,280,1417,327],'lift','left'),room('Stair',[900,1196,995,1250],'stair','top')],
  curtains:[[[706,294],[706,1165]],[[974,293],[974,1158]],[[1247,418],[1247,1100]]],
  allocations:[[496,346,682,422],[730,346,921,422],[1008,346,1087,422],[1130,376,1273,454],
    [496,456,1200,653],[488,687,681,805],[730,687,921,805],[1008,687,1097,805],[1150,687,1358,968],
    [488,839,680,1035],[731,839,920,1035],[1008,839,1097,1035],[552,1070,681,1120],[731,1070,921,1129]]
};
const plan6: HallPlan = {
  id:'hall6',source:'hall6.pdf (hall-6.pdf is identical)',floor:'Hall 6; floor not labelled',metresPerPixel:120.45/(1330-207),
  outline:[[136,262],[1428,262],[1518,350],[1438,433],[1515,487],[1532,568],[1532,781],[1496,863],[1438,899],[1518,981],[1428,1067],[136,1067]],
  exhibition:[[210,280],[1328,280],[1328,1048],[210,1048]],entry:[1532,665],inward:[1220,665],foyer:[1350,469,1510,850],
  route:[[1430,665],[1290,710],[1100,760],[800,760],[435,750],[400,440],[805,440],[1165,440],[1290,560],[1290,710],[1430,665]],
  columns:[374,536,696,857,1010,1178].map(x=>[x,664]),columnSize:1.2,
  rooms:[room('Female toilets',[140,268,192,346],'toilet','right'),room('Male toilets',[140,355,192,453],'toilet','right'),
    room('Male toilets',[140,932,193,973],'toilet','right'),room('Female toilets',[140,979,193,1048],'toilet','right'),
    room('Stair',[140,855,193,921],'stair','right'),room('Male toilets',[1351,265,1414,349],'toilet','left'),
    room('Female toilets',[1418,300,1467,351],'toilet','bottom'),room('Stair',[1345,377,1431,429],'stair','bottom'),
    room('Service lift',[1347,435,1370,457],'lift','bottom'),room('Guest lift',[1375,435,1395,457],'lift','bottom'),
    room('Guest lift',[1400,435,1424,457],'lift','bottom'),room('Fire control 6-F2',[1349,862,1385,896],'service','top'),
    room('Hall master 6-F1',[1390,862,1430,896],'room','top'),room('Stair',[1349,901,1434,952],'stair','top'),
    room('Female toilets',[1350,980,1414,1054],'toilet','left'),room('Male toilets',[1419,974,1465,1035],'toilet','top')],
  curtains:[[[669,280],[669,1047]],[[883,280],[883,1047]],[[210,664],[1328,664]]],
  allocations:[[278,344,538,472],[568,344,650,472],[697,344,790,472],[903,344,1287,594],
    [278,500,538,585],[568,500,650,585],[697,500,790,585],[903,623,1287,651],
    [278,613,379,641],[410,613,538,641],[568,613,650,818],[697,613,790,818],[818,678,845,818],
    [278,737,538,818],[903,678,1287,826],[278,846,538,987],[568,846,650,987],[697,846,790,987],[903,846,1287,987]]
};
function rectangular(id: number, left: number, right: number, top: number, column: number, width: number): HallPlan {
  const middle=(left+right)/2, bottom=913;
  const service:Record<number,[PlanRect,PlanRect,PlanRect,PlanRect,PlanRect,PlanRect]> = {
    2:[[1483,454,1548,499],[1662,454,1724,499],[1423,456,1473,499],[1607,456,1656,499],[1425,922,1478,950],[1664,922,1716,974]],
    3:[[1012,454,1075,499],[1178,454,1240,499],[1091,456,1143,499],[1262,456,1314,499],[1012,922,1067,953],[1259,922,1312,949]],
    4:[[744,454,809,499],[893,454,950,499],[672,456,718,499],[827,456,877,499],[668,922,720,950],[897,922,950,949]],
    5:[[109,140,161,178],[531,140,593,178],[278,143,325,178],[408,143,450,178],[195,922,245,974],[499,922,552,949]]
  };
  const cells=service[id];
  const rooms:PlanRoom[] = [room(`Toilet ${id}G-C`,cells[0],'toilet','bottom'),room(`Toilet ${id}G-D`,cells[1],'toilet','bottom'),
    room('Stair and lift lobby',cells[2],'stair','bottom'),room('Stair and lift lobby',cells[3],'stair','bottom'),
    room(`Toilet ${id}G-B`,cells[4],'toilet','right'),room(`Toilet ${id}G-A`,cells[5],'toilet','left')];
  const masters:Record<number,PlanRect[]>={2:[[1456,958,1480,985]],3:[[1070,958,1093,985],[1268,958,1292,985]],
    4:[[692,958,716,985],[891,958,915,985]],5:[[505,958,529,985]]};
  masters[id].forEach(rect=>rooms.push(room('Hall master',rect,'room',(rect[0]+rect[2])/2<middle?'right':'left')));
  if(id===2)rooms.push(room('First aid',[1604,928,1643,954],'room','bottom'));
  if(id===5)rooms.push(room('Office',[109,699,139,720],'room','right'),room('Lounge 3',[109,724,139,752],'room','right'),
    room('Lounge 2',[109,815,139,859],'room','right'),room('Lounge 1',[109,864,139,910],'room','right'));
  const rows=id===5?[285,389,493,602,706,811]:[601,706,811];
  return {id:'hall'+id,source:'hall 2-5.pdf',floor:'Ground floor',metresPerPixel:width/(right-left),
    outline:[[left-5,top-54],[right+5,top-54],[right+5,981],[right-44,1038],[left+44,1038],[left-5,981]],
    exhibition:[[left,top],[right,top],[right,bottom],[left,bottom]],entry:[middle,1038],inward:[middle,870],
    foyer:[left+64,919,right-64,1038],route:[[middle,999],[middle,879],[middle-55,838],[middle-55,top+65],
      [middle+65,top+65],[middle+65,845],[middle,879],[middle,999]],
    columns:rows.map(y=>[column,y]),columnSize:2.2,rooms,
    curtains:id===5?[316,468,624,779].map(y=>[[left,y],[right,y]]):[left+(.34)*(right-left),left+.73*(right-left)].map(x=>[[x,top],[x,bottom]]),
    allocations:rows.flatMap((y,i)=>{const a=Math.max(top+20,y-57),b=Math.min(bottom-20,y+27);return [[left+20,a,column-35,b],[column+35,a,right-20,b]] as PlanRect[];})};
}
export const HALL_PLANS: HallPlan[] = [plan1,rectangular(2,1380,1783,507,1565,71.82),
  rectangular(3,993,1371,507,1180,66.75),rectangular(4,619,988,507,801,65.75),
  rectangular(5,109,600,185,368,86.75),plan6,plan14];
