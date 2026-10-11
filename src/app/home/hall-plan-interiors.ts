import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALL_PLANS, PlanPoint, PlanRect } from './hall-plan-data';
import { insideHall, InteriorHall, InteriorObstacle, worldToHall } from './venue-interiors';
import { createPortal } from './visitor-navigation';

/** Uniformly register a measured drawing inside an existing, unsurveyed shell.
 * Source metres and the display scale are kept separately: fitting is never
 * reported as a surveyed dimensional reconstruction. */
export function registerHallPlan(hall: InteriorHall) {
  const plan=HALL_PLANS.find(p=>p.id===hall.id);
  if (!plan) return;
  const portal=createPortal(hall,[]), door=worldToHall(hall,portal.position);
  const out=worldToHall(hall,portal.position.clone().add(portal.outward)).sub(door);
  const xs=plan.outline.map(p=>p[0]), zs=plan.outline.map(p=>p[1]);
  const origin:[number,number]=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2];
  const forward=new T.Vector2(plan.entry[0]-plan.inward[0],plan.entry[1]-plan.inward[1]).normalize();
  // Roof fitting can return an equivalent axis rotated by 90/180 degrees. Pick
  // the axis that fits the drawing's long side, then its public-facing end.
  // Hall 6's supplied foyer lies at its long-axis east end by the covered link.
  const preferred=hall.id==='hall6'?new T.Vector2(1,0):new T.Vector2(out.x,out.z).normalize();
  const mapped=(p:PlanPoint,scale:number,turn:number):PlanPoint=>{
    const c=Math.cos(turn),s=Math.sin(turn);
    const x=(p[0]-origin[0])*plan.metresPerPixel*scale,z=(p[1]-origin[1])*plan.metresPerPixel*scale;
    return [x*c-z*s,x*s+z*c];
  };
  const candidates=[0,Math.PI/2,Math.PI,Math.PI*1.5].map(turn=>{
    let low=0,high=1;
    for(let i=0;i<26;i++) {
      const mid=(low+high)/2;
      if(plan.outline.every(p=>insideHall(hall,...mapped(p,mid,turn),2)))low=mid;else high=mid;
    }
    const direction=forward.clone().rotateAround(new T.Vector2(),turn);
    return {turn,scale:low,facing:direction.dot(preferred)};
  });
  const maxScale=Math.max(...candidates.map(c=>c.scale));
  const {scale,turn}=candidates.filter(c=>c.scale>maxScale*.90).sort((a,b)=>b.facing-a.facing)[0];
  return {plan,scale,turn,point:(p:PlanPoint)=>mapped(p,scale,turn),portal,door};
}

/** Architectural rooms and columns replace the illustrative exhibition kit.
 * Walls and navigation obstacles are generated from the same transformed faces. */
export function buildHallPlanInterior(hall:InteriorHall,parent:T.Group,blocks:InteriorObstacle[]) {
  const registration=registerHallPlan(hall);
  if(!registration)return;
  const {plan,scale,point,turn}=registration;
  const group=new T.Group();group.name=`${hall.id} supplied floor plan`;parent.add(group);
  const materials={
    wall:new T.MeshStandardMaterial({color:'#d8d5ca',roughness:.87}),
    trim:new T.MeshStandardMaterial({color:'#747e79',roughness:.73}),
    floor:new T.MeshStandardMaterial({color:'#b3b8b3',roughness:.64}),
    foyer:new T.MeshStandardMaterial({color:'#c8c0af',roughness:.58}),
    tile:new T.MeshStandardMaterial({color:'#b6cac5',roughness:.55}),
    steel:new T.MeshStandardMaterial({color:'#6f777b',roughness:.4,metalness:.52}),
    allocation:new T.MeshStandardMaterial({color:'#999c90',roughness:.95}),
    light:new T.MeshStandardMaterial({color:'#eee5d0',roughness:.55,emissive:'#fff1d2',emissiveIntensity:.7}),
  };
  const bins=new Map<T.Material,T.BufferGeometry[]>(),geometries=new Set<T.BufferGeometry>();
  const textures=new Set<T.Texture>(),labelMaterials=new Set<T.Material>();
  const names:Record<string,number>={};
  const add=(geometry:T.BufferGeometry,material:T.Material)=>{
    const list=bins.get(material)??[];list.push(geometry);bins.set(material,list);
  };
  const footprint=(corners:PlanPoint[])=>{
    const xs=corners.map(p=>p[0]),zs=corners.map(p=>p[1]);
    blocks.push({minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),polygon:corners});
  };
  function boxLocal(center:PlanPoint,w:number,h:number,d:number,y:number,angle:number,material:T.Material,solid=false) {
    if(w<=0||h<=0||d<=0)return;
    const geometry=new T.BoxGeometry(w,h,d).rotateY(-angle).translate(center[0],y+h/2,center[1]);
    add(geometry,material);
    if(solid) {
      const c=Math.cos(angle),s=Math.sin(angle);
      footprint([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,z])=>[center[0]+x*c-z*s,center[1]+x*s+z*c]));
    }
  }
  function strip(a:PlanPoint,b:PlanPoint,width:number,height:number,y:number,material:T.Material,solid=false) {
    const dx=b[0]-a[0],dz=b[1]-a[1];
    boxLocal([(a[0]+b[0])/2,(a[1]+b[1])/2],Math.hypot(dx,dz),height,width,y,Math.atan2(dz,dx),material,solid);
  }
  function slab(points:PlanPoint[],y:number,material:T.Material) {
    const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,z)));
    // Shape coordinates are X/Z; preserve their handedness when laying flat.
    const geometry=new T.ShapeGeometry(shape).rotateX(Math.PI/2);
    geometry.translate(0,y,0);geometry.scale(1,1,1);
    // ShapeGeometry faces down after this rotation; orient normals upward.
    const indices=geometry.index!;for(let i=0;i<indices.count;i+=3){const a=indices.getX(i);indices.setX(i,indices.getX(i+2));indices.setX(i+2,a);}
    geometry.computeVertexNormals();add(geometry,material);
  }
  const rectPoints=([x0,z0,x1,z1]:PlanRect):PlanPoint[]=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
  const planRect=(r:PlanRect,y:number,material:T.Material)=>slab(rectPoints(r).map(point),y,material);
  slab(plan.exhibition.map(point),.026,materials.floor);
  planRect(plan.foyer,.032,materials.foyer);
  // Main public doors are read from the foyer/exhibition interface in each plan.
  const entryDoors:PlanPoint[]=hall.id==='hall14'?[[1260,610],[1260,846]]:hall.id==='hall1'?[[451,610],[451,855]]:
    hall.id==='hall6'?[[1328,560],[1328,790]]:[[(plan.foyer[0]+plan.foyer[2])/2,913]];
  const serviceDoors:PlanPoint[]=hall.id==='hall14'?[[720,270],[1060,1170],[280,495],[280,975]]:
    hall.id==='hall1'?[[900,295],[1045,1150],[1430,530],[1372,990]]:
    hall.id==='hall6'?[[410,280],[1110,280],[210,560],[210,790],[1110,1048]]:
    [[plan.exhibition[0][0]+(plan.exhibition[1][0]-plan.exhibition[0][0])*.5,plan.exhibition[0][1]]];
  const doorPoints=[...entryDoors,...serviceDoors].map(point);
  const lineDistance=(p:PlanPoint,a:PlanPoint,b:PlanPoint)=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),along=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length;
    return {length,along,across:Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/length};
  };
  function wallWithDoors(a:PlanPoint,b:PlanPoint,doors:PlanPoint[],height=3.6,width=.20) {
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.05)return;
    const spans=doors.map(p=>lineDistance(p,a,b)).filter(p=>p.across<1.5&&p.along>-1&&p.along<length+1)
      .map(p=>[Math.max(0,p.along-2.1),Math.min(length,p.along+2.1)]).sort((a,b)=>a[0]-b[0]);
    let from=0;
    const at=(v:number):PlanPoint=>[a[0]+(b[0]-a[0])*v/length,a[1]+(b[1]-a[1])*v/length];
    for(const [start,end] of [...spans,[length,length]]) {
      if(start>from) {
        strip(at(from),at(start),width,height,0,materials.wall,true);
        strip(at(from),at(start),width+.035,.65,.05,materials.trim);
      }
      if(end>start)strip(at(start),at(end),width,height-2.65,2.65,materials.wall);
      from=Math.max(from,end);
    }
  }
  const boundary=plan.exhibition.map(point);
  for(let i=0;i<boundary.length;i++)wallWithDoors(boundary[i],boundary[(i+1)%boundary.length],doorPoints);
  for(const position of plan.columns) {
    const p=point(position),w=plan.columnSize*scale;
    boxLocal(p,w,Math.max(5,hall.height-1.1),w,0,turn,materials.wall,true);
    boxLocal(p,w+.10,.6,w+.10,0,turn,materials.trim);
    names['columns']=(names['columns']??0)+1;
  }
  function label(text:string,p:PlanPoint,y:number,heading=turn) {
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#273b36';ctx.fillRect(0,0,512,96);ctx.fillStyle='#fffaf0';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='500 34px Arial';ctx.fillText(text,256,49,475);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;textures.add(texture);
    const material=new T.MeshBasicMaterial({map:texture,side:T.DoubleSide});labelMaterials.add(material);
    const geometry=new T.PlaneGeometry(3.2,.6);geometries.add(geometry);
    const mesh=new T.Mesh(geometry,material);mesh.position.set(p[0],y,p[1]);mesh.rotation.y=-heading;
    mesh.userData['hallPlanLabel']=true;mesh.name=text;group.add(mesh);
  }
  for(const r of plan.rooms) {
    const corners=rectPoints(r.rect).map(point),[x0,z0,x1,z1]=r.rect;
    const center=point([(x0+x1)/2,(z0+z1)/2]);
    slab(corners,.038,r.kind==='toilet'?materials.tile:materials.foyer);
    const doorIndex={top:0,right:1,bottom:2,left:3}[r.door];
    for(let i=0;i<4;i++) {
      const a=corners[i],b=corners[(i+1)%4],middle:PlanPoint=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      if(i===doorIndex) {
        // Full 1.9m clear doors remain usable after the building-scale fit.
        const length=Math.hypot(b[0]-a[0],b[1]-a[1]),gap=Math.min(2,Math.max(1.9,length-.4));
        const aEnd:PlanPoint=[middle[0]-(b[0]-a[0])*gap/length/2,middle[1]-(b[1]-a[1])*gap/length/2];
        const bStart:PlanPoint=[middle[0]+(b[0]-a[0])*gap/length/2,middle[1]+(b[1]-a[1])*gap/length/2];
        if(length>gap+.05){strip(a,aEnd,.16,3.2,0,materials.wall,true);strip(bStart,b,.16,3.2,0,materials.wall,true);}
        strip(aEnd,bStart,.18,.55,2.65,materials.trim);
        label(r.label,middle,2.98,Math.atan2(b[1]-a[1],b[0]-a[0]));
      } else strip(a,b,.16,3.2,0,materials.wall,true);
    }
    if(r.kind==='lift')boxLocal(center,Math.max(.7,(x1-x0)*plan.metresPerPixel*scale*.65),2.35,.08,0,turn,materials.steel,true);
    if(r.kind==='stair') {
      const w=(x1-x0)*plan.metresPerPixel*scale*.5,d=(z1-z0)*plan.metresPerPixel*scale*.6;
      // A depicted stair core, not an invented connection to an unknown floor.
      for(let step=0;step<10;step++) {
        const p=point([(x0+x1)/2,z0+(z1-z0)*(.2+step*.055)]);
        boxLocal(p,w,.17,d/10,step*.17,turn,materials.floor,step>1);
      }
    }
    names[r.kind]=(names[r.kind]??0)+1;
  }
  // Smoke curtains are overhead tracks and clear floor strips, never solid walls.
  for(const [a,b] of plan.curtains) {
    strip(point(a),point(b),Math.max(.45,scale),.012,.044,materials.foyer);
    strip(point(a),point(b),.18,.25,hall.height-1.2,materials.steel);
  }
  for(const rect of plan.allocations) {
    const corners=rectPoints(rect).map(point);
    for(let i=0;i<4;i++)strip(corners[i],corners[(i+1)%4],.045,.012,.046,materials.allocation);
  }
  const foyerCenter=point([(plan.foyer[0]+plan.foyer[2])/2,(plan.foyer[1]+plan.foyer[3])/2]);
  label(`${hall.label} · Exhibition`,point(entryDoors[0]),3.22,turn+(hall.id==='hall1'?Math.PI:0));
  group.userData={source:plan.source,sourceDate:'2026-05-29',sourceFloor:plan.floor,uniformDisplayScale:scale,
    sourceMetresPerPixel:plan.metresPerPixel,components:names,planEntry:point(plan.entry),exhibitionEntry:point(entryDoors[0]),
    assumptions:'Interior plan fitted uniformly to retained exterior; existing ground elevation retained; room wall heights 3.2m, hall partitions 3.6m and clear door widths are visualization assumptions. Stair/lift cores do not imply verified upper-floor connections.'};
  // Enter at the drawn foyer. The tour is routed against the completed collision
  // footprints by the caller; columns and rooms cannot trap the guided camera.
  hall.route=[foyerCenter,...plan.route.map(point)];
  hall.entrance=point(plan.entry);
  for(const [material,list] of bins) {
    const geometry=mergeGeometries(list,false)!;list.forEach(g=>g.dispose());geometries.add(geometry);
    const mesh=new T.Mesh(geometry,material);mesh.name=`${hall.id} plan architecture`;mesh.receiveShadow=true;mesh.castShadow=false;group.add(mesh);
  }
  return {group,registration,
    dispose(){group.removeFromParent();geometries.forEach(g=>g.dispose());Object.values(materials).forEach(m=>m.dispose());labelMaterials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();},
    setDaylight(day:boolean){materials.light.emissiveIntensity=day?.7:1.4;}
  };
}
