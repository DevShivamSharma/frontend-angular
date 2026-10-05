import { mergeFootprints } from '../drafting/cad-geometry';
import { edges, EPS, normal, pointSegmentDistance, stallPolygon, dot, sub } from './polygon-geometry';
import type { GateSide, Stall } from '../models/stall.model';

const SIDES: GateSide[] = ['BACK', 'RIGHT', 'FRONT', 'LEFT'];
/** Positive-length shared wall, including rotated rectangles; corner contact is not a wall. */
function shared(a: ReturnType<typeof edges>[number], b: ReturnType<typeof edges>[number]): boolean {
  const ab=sub(a[1],a[0]), length=Math.hypot(ab.x,ab.z), u={x:ab.x/length,z:ab.z/length};
  const distance=(p:typeof u)=>Math.abs((p.x-a[0].x)*u.z-(p.z-a[0].z)*u.x);
  if(distance(b[0])>EPS || distance(b[1])>EPS) return false;
  const p=dot(sub(b[0],a[0]),u), q=dot(sub(b[1],a[0]),u);
  return Math.min(length,Math.max(p,q))-Math.max(0,Math.min(p,q))>EPS;
}
export function batchOpenSides(picked: readonly Stall[], all: readonly Stall[], side: GateSide, mode: 'set'|'toggle'|'opposite'): Stall[] {
  return picked.map(stall=>{
    if(stall.footprint?.length) throw Error('Use the edge editor for custom-shaped stalls. Select rectangular stalls for batch sides.');
    let openSides=[...stall.openSides];
    if(mode==='set') openSides=[side];
    if(mode==='toggle') openSides=openSides.includes(side)?openSides.filter(s=>s!==side):[...openSides,side];
    if(mode==='opposite') {
      const polygon=stallPolygon(stall), walls=new Set<number>();
      for(const other of all) {
        if(String(other.id)===String(stall.id) || other.status==='CANCELLED') continue;
        const otherPolygon=stallPolygon(other);
        edges(polygon).forEach((edge,i)=>edges(otherPolygon).forEach((otherEdge,j)=>{
          if(dot(normal(polygon,i),normal(otherPolygon,j)) < -0.999 && shared(edge,otherEdge)) walls.add(i);
        }));
      }
      if(walls.size) {
        const preferred=[...walls].map(i=>(i+2)%4).filter(i=>!walls.has(i));
        const candidates=preferred.length?preferred:SIDES.map((_,i)=>i).filter(i=>!walls.has(i));
        if(!candidates.length) throw Error('A selected stall is enclosed by shared walls. It needs an accessible outer side.');
        openSides=[SIDES[candidates[0]]];
      }
    }
    if(!openSides.length) throw Error('Every stall needs at least one open side. The batch was kept unchanged.');
    return {...stall,openSides,gateSide:openSides[0]};
  });
}
export function pavilion(picked: readonly Stall[]): Stall {
  if(picked.length<3 || picked.length>4) throw Error('Select 3 or 4 adjacent stalls to merge into a pavilion.');
  if(picked.some(s=>s.status!=='AVAILABLE')) throw Error('Only available stalls can be merged.');
  const shape=mergeFootprints(picked);
  if(!shape) throw Error('Select 3 or 4 unrotated rectangles that share walls and form one rectangle, without gaps or overlaps.');
  return {...picked[0],...shape,id:'local-pavilion-'+crypto.randomUUID(),name:'Pavilion',
    stallNumber:null,parentStallNumber:null,stallTypeId:null,footprint:undefined,openEdges:undefined,status:'AVAILABLE'};
}
