/* Author connected road surfaces from traced lines. No test runner is involved. */
const fs = require('node:fs');
const path = require('node:path');
const clip = require('polygon-clipping');
const root = path.resolve(__dirname, '..');
const work = path.join(root, 'work/venue-surroundings');
const reference = JSON.parse(fs.readFileSync(path.join(work, 'reference.json'), 'utf8'));
const connections = JSON.parse(fs.readFileSync(path.join(work, 'road-connections.json'), 'utf8'));
const registration = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-site-detail.json'), 'utf8'));
const satellite = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/geography/satellite/satellite.json'), 'utf8')).layers.find(x => x.name === 'inner');
const { x, z } = registration.affine, det = x[0]*z[1]-x[1]*z[0];
const world = p => [x[0]*p[0]+x[1]*p[1]+x[2], z[0]*p[0]+z[1]*p[1]+z[2]];
const pixel = p => [((p[0]-x[2])*z[1]-(p[1]-z[2])*x[1])/det, ((p[1]-z[2])*x[0]-(p[0]-x[2])*z[0])/det];
const fromSatellite = p => pixel(satellite.corners[0].map((v,i) => v + (satellite.corners[1][i]-v)*p[0]/connections.satelliteCoordinateSize + (satellite.corners[3][i]-v)*p[1]/connections.satelliteCoordinateSize));
const roads = structuredClone(reference.roads);
for (const road of roads) {
  const edit = connections.photoEdits[road.id];
  if (edit?.first) road.points[0] = edit.first;
  if (edit?.prepend) road.points.unshift(...edit.prepend);
  const extension = connections.satelliteExtensions[road.id];
  if (extension?.prepend) road.points.unshift(...extension.prepend.map(fromSatellite));
  if (extension?.append) road.points.push(...extension.append.map(fromSatellite));
  if (extension?.joinRoadEnd) road.points.push(reference.roads.find(r => r.id === extension.joinRoadEnd).points[0]);
}
for (const road of connections.additionalRoads) roads.push({id:road.id,width:road.width,median:road.median,points:[...(road.startPhoto?[road.startPhoto]:[]),...(road.photo??[]),...(road.satellite??[]).map(fromSatellite),...(road.endPhoto?[road.endPhoto]:[])]});

// Snap short gaps to the existing corridor, then split every true intersection.
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], cross=(a,b)=>a[0]*b[1]-a[1]*b[0], lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const project=(p,a,b)=>{const d=sub(b,a),q=sub(p,a),t=Math.max(0,Math.min(1,(q[0]*d[0]+q[1]*d[1])/(d[0]**2+d[1]**2)));const point=lerp(a,b,t);return{point,distance:Math.hypot(...sub(p,point))};};
let lines=roads.map(r=>r.points.map(world));
for(let ri=0;ri<lines.length;ri++) for(const end of [0,lines[ri].length-1]) {
  let best={distance:.55};
  for(let oi=0;oi<lines.length;oi++) if(oi!==ri) for(let j=1;j<lines[oi].length;j++) {const q=project(lines[ri][end],lines[oi][j-1],lines[oi][j]);if(q.distance<best.distance)best=q;}
  if(best.point)lines[ri][end]=best.point;
}
const segments=[];
lines.forEach((line,ri)=>line.slice(1).forEach((b,j)=>segments.push({ri,a:line[j],b,cuts:[0,1]})));
for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length;j++) {
  const a=segments[i],b=segments[j],u=sub(a.b,a.a),v=sub(b.b,b.a),d=cross(u,v);
  if(Math.abs(d)<1e-8)continue;
  const q=sub(b.a,a.a),t=cross(q,v)/d,s=cross(q,u)/d;
  if(t>=-1e-7&&t<=1+1e-7&&s>=-1e-7&&s<=1+1e-7){a.cuts.push(Math.max(0,Math.min(1,t)));b.cuts.push(Math.max(0,Math.min(1,s)));}
}
const nodes=[], edges=[];
function node(p){let i=nodes.findIndex(n=>Math.hypot(...sub(n.p,p))<.15);if(i<0){i=nodes.length;nodes.push({p,edges:[],roads:new Set()});}return i;}
for(const s of segments) {
  s.cuts.sort((a,b)=>a-b);
  for(let i=1;i<s.cuts.length;i++){if(s.cuts[i]-s.cuts[i-1]<1e-6)continue;const a=node(lerp(s.a,s.b,s.cuts[i-1])),b=node(lerp(s.a,s.b,s.cuts[i]));if(a===b)continue;const index=edges.length;edges.push({a,b,road:s.ri});for(const n of [a,b]){nodes[n].edges.push(index);nodes[n].roads.add(s.ri);}}
}
const junctions=nodes.filter(n=>n.edges.length>=3).map(n=>({p:n.p,radius:Math.max(...[...n.roads].map(ri=>roads[ri].width))/2+6,roads:[...n.roads].map(ri=>roads[ri].id)}));
const components=[];const seen=new Set();
for(let i=0;i<nodes.length;i++)if(!seen.has(i)){const queue=[i],part=[];seen.add(i);while(queue.length){const n=queue.pop();part.push(n);for(const ei of nodes[n].edges){const e=edges[ei],next=e.a===n?e.b:e.a;if(!seen.has(next)){seen.add(next);queue.push(next);}}}components.push(part);}

const circle=(p,r)=>[Array.from({length:25},(_,i)=>[p[0]+Math.cos(i*Math.PI/12)*r,p[1]+Math.sin(i*Math.PI/12)*r])];
function corridor(points,width){const r=width/2,parts=points.map(p=>circle(p,r));for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=sub(b,a),len=Math.hypot(...d),n=[-d[1]/len*r,d[0]/len*r];parts.push([[a.map((v,k)=>v+n[k]),b.map((v,k)=>v+n[k]),b.map((v,k)=>v-n[k]),a.map((v,k)=>v-n[k]),a.map((v,k)=>v+n[k])]]);}return clip.union(...parts);}
const asphalt=clip.union(...lines.map((l,i)=>corridor(l,roads[i].width)));
const apron=clip.union(...lines.map((l,i)=>corridor(l,roads[i].width+6)));
const footpaths=clip.difference(apron,asphalt);
const mouths=junctions.length?clip.union(...junctions.map(j=>circle(j.p,j.radius))):[];
const medians=clip.difference(clip.union(...lines.flatMap((l,i)=>roads[i].median?[corridor(l,roads[i].median)]:[])),mouths);
const kerbs=clip.difference(clip.union(...lines.map((l,i)=>corridor(l,roads[i].width+.45))),asphalt);
const edgePaint=clip.difference(clip.difference(clip.union(...lines.map((l,i)=>corridor(l,roads[i].width-1))),clip.union(...lines.map((l,i)=>corridor(l,roads[i].width-1.28)))),mouths);
const toPixels=polys=>polys.map(poly=>poly.map(ring=>ring.map(pixel)));
roads.forEach((r,i)=>r.points=lines[i].map(pixel));
const all=roads.flatMap(r=>r.points);
const bounds=[Math.min(...all.map(p=>p[0]))-80,Math.min(...all.map(p=>p[1]))-80,Math.max(...all.map(p=>p[0]))+80,Math.max(...all.map(p=>p[1]))+80];
const result={source:connections.source,status:connections.status,roads,bounds,junctions:junctions.map(j=>({...j,p:pixel(j.p)})),surfaces:{asphalt:toPixels(asphalt),footpaths:toPixels(footpaths),kerbs:toPixels(kerbs),medians:toPixels(medians),edgePaint:toPixels(edgePaint)},topology:{components:components.length,junctions:junctions.length,segments:edges.length,openEnds:nodes.filter(n=>n.edges.length===1).map(n=>({p:pixel(n.p),road:[...n.roads].map(i=>roads[i].id)}))}};
fs.writeFileSync(path.join(work,'roads-prepared.json'),JSON.stringify(result));
console.log(JSON.stringify({roads:roads.length,...result.topology}));
