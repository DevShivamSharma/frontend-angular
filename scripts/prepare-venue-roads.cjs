/* Author connected road and walkway surfaces from traced lines. No test runner is involved. */
const fs = require('node:fs');
const path = require('node:path');
const clip = require('polygon-clipping');
const root = path.resolve(__dirname, '..');
const work = path.join(root, 'work/venue-surroundings');
const connections = JSON.parse(fs.readFileSync(path.join(work, 'road-connections.json'), 'utf8'));
const registration = JSON.parse(fs.readFileSync(path.join(root, 'src/assets/venue/venue-site-detail.json'), 'utf8'));
const satellite = JSON.parse(fs.readFileSync(path.join(work, 'satellite-reference.json'), 'utf8')).fit;
const { x, z } = registration.affine, det = x[0]*z[1]-x[1]*z[0];
const pixel = p => [((p[0]-x[2])*z[1]-(p[1]-z[2])*x[1])/det, ((p[1]-z[2])*x[0]-(p[0]-x[2])*z[0])/det];
// Traces are in z18 satellite pixels; everything downstream stays in the reference image's pixels.
const fromSatellite = p => [satellite.x[0]*p[0]+satellite.x[1]*p[1]+satellite.x[2], satellite.z[0]*p[0]+satellite.z[1]*p[1]+satellite.z[2]];
const roads = structuredClone(connections.roads);
const walkways = structuredClone(connections.walkways);

// Snap short gaps to the existing corridor, then split every true intersection.
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], cross=(a,b)=>a[0]*b[1]-a[1]*b[0], lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const project=(p,a,b)=>{const d=sub(b,a),q=sub(p,a),t=Math.max(0,Math.min(1,(q[0]*d[0]+q[1]*d[1])/(d[0]**2+d[1]**2)));const point=lerp(a,b,t);return{point,distance:Math.hypot(...sub(p,point))};};
function snapEnds(lines,targets,tolerance){
  for(let ri=0;ri<lines.length;ri++) for(const end of [0,lines[ri].length-1]) {
    let best={distance:tolerance};
    for(const other of targets) if(other!==lines[ri]) for(let j=1;j<other.length;j++) {const q=project(lines[ri][end],other[j-1],other[j]);if(q.distance<best.distance)best=q;}
    if(best.point)lines[ri][end]=best.point;
  }
}
function network(lines,widths){
  const segments=[];
  lines.forEach((line,ri)=>line.slice(1).forEach((b,j)=>segments.push({ri,a:line[j],b,cuts:[0,1]})));
  for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length;j++) {
    const a=segments[i],b=segments[j],u=sub(a.b,a.a),v=sub(b.b,b.a),d=cross(u,v);
    if(Math.abs(d)<1e-8)continue;
    const q=sub(b.a,a.a),t=cross(q,v)/d,s=cross(q,u)/d;
    if(t>=-1e-7&&t<=1+1e-7&&s>=-1e-7&&s<=1+1e-7){a.cuts.push(Math.max(0,Math.min(1,t)));b.cuts.push(Math.max(0,Math.min(1,s)));}
  }
  const nodes=[], edges=[];
  function node(p){let i=nodes.findIndex(n=>Math.hypot(...sub(n.p,p))<.15);if(i<0){i=nodes.length;nodes.push({p,edges:[],lines:new Set()});}return i;}
  for(const s of segments) {
    s.cuts.sort((a,b)=>a-b);
    for(let i=1;i<s.cuts.length;i++){if(s.cuts[i]-s.cuts[i-1]<1e-6)continue;const a=node(lerp(s.a,s.b,s.cuts[i-1])),b=node(lerp(s.a,s.b,s.cuts[i]));if(a===b)continue;const index=edges.length;edges.push({a,b,line:s.ri});for(const n of [a,b]){nodes[n].edges.push(index);nodes[n].lines.add(s.ri);}}
  }
  const junctions=nodes.filter(n=>n.edges.length>=3).map(n=>({p:n.p,radius:Math.max(...[...n.lines].map(ri=>widths[ri]))/2+6,lines:[...n.lines]}));
  const components=[];const seen=new Set();
  for(let i=0;i<nodes.length;i++)if(!seen.has(i)){const queue=[i],part=[];seen.add(i);while(queue.length){const n=queue.pop();part.push(n);for(const ei of nodes[n].edges){const e=edges[ei],next=e.a===n?e.b:e.a;if(!seen.has(next)){seen.add(next);queue.push(next);}}}components.push(part);}
  return {nodes,edges,junctions,components};
}

let lines=roads.map(r=>r.points.map(fromSatellite));
snapEnds(lines,lines,.55);
const roadNetwork=network(lines,roads.map(r=>r.width));
const junctions=roadNetwork.junctions.map(j=>({p:j.p,radius:j.radius,roads:j.lines.map(ri=>roads[ri].id)}));

const circle=(p,r)=>[Array.from({length:25},(_,i)=>[p[0]+Math.cos(i*Math.PI/12)*r,p[1]+Math.sin(i*Math.PI/12)*r])];
function corridor(points,width){const r=width/2,parts=points.map(p=>circle(p,r));for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=sub(b,a),len=Math.hypot(...d),n=[-d[1]/len*r,d[0]/len*r];parts.push([[a.map((v,k)=>v+n[k]),b.map((v,k)=>v+n[k]),b.map((v,k)=>v-n[k]),a.map((v,k)=>v-n[k]),a.map((v,k)=>v+n[k])]]);}return clip.union(...parts);}
const asphalt=clip.union(...lines.map((l,i)=>corridor(l,roads[i].width)));
// Asphalt split by road class (arterial over local over the rest) so Color → Map can shade the hierarchy.
const ofClass=c=>lines.flatMap((l,i)=>(roads[i].class??'local')===c?[corridor(l,roads[i].width)]:[]);
const union=parts=>parts.length?clip.union(...parts):[];
const asphaltArterial=union(ofClass('arterial'));
const asphaltLocal=clip.difference(union(ofClass('local')),asphaltArterial);
const asphaltOther=clip.difference(asphalt,asphaltArterial,asphaltLocal);
const apron=clip.union(...lines.map((l,i)=>corridor(l,roads[i].width+6)));
const footpaths=clip.difference(apron,asphalt);
const mouths=junctions.length?clip.union(...junctions.map(j=>circle(j.p,j.radius))):[];
const medians=clip.difference(clip.union(...lines.flatMap((l,i)=>roads[i].median?[corridor(l,roads[i].median)]:[])),mouths);
const kerbs=clip.difference(clip.union(...lines.map((l,i)=>corridor(l,roads[i].width+.45))),asphalt);
const edgePaint=clip.difference(clip.difference(clip.union(...lines.map((l,i)=>corridor(l,roads[i].width-1))),clip.union(...lines.map((l,i)=>corridor(l,roads[i].width-1.28)))),mouths);

// Internal service roads and walkways: their ends join the nearest road or walkway
// within 6 m so the route graph is continuous, and their paving stops at the road apron.
const walkLines=walkways.map(w=>w.points.map(fromSatellite));
snapEnds(walkLines,[...walkLines,...lines],6);
const walkNetwork=network(walkLines,walkways.map(w=>w.width));
const ofType=type=>walkLines.flatMap((l,i)=>walkways[i].type===type?[corridor(l,walkways[i].width)]:[]);
const serviceRoads=clip.difference(clip.union(...ofType('service')),apron);
const walkPaving=clip.difference(clip.union(...ofType('path')),apron,serviceRoads);

const toPixels=polys=>polys.map(poly=>poly.map(ring=>ring.map(pixel)));
roads.forEach((r,i)=>r.points=lines[i].map(pixel));
walkways.forEach((w,i)=>w.points=walkLines[i].map(pixel));
const all=roads.flatMap(r=>r.points);
const bounds=[Math.min(...all.map(p=>p[0]))-80,Math.min(...all.map(p=>p[1]))-80,Math.max(...all.map(p=>p[0]))+80,Math.max(...all.map(p=>p[1]))+80];
const openEnds=(net,items,key)=>net.nodes.filter(n=>n.edges.length===1).map(n=>({p:pixel(n.p),[key]:[...n.lines].map(i=>items[i].id)}));
// A walkway end that sits on a road centreline is a gate onto that road, not a dead end.
const roadAt=p=>roads.find((r,i)=>lines[i].some((b,j)=>j&&project(p,lines[i][j-1],b).distance<.2))?.id;
const walkwayEnds=walkNetwork.nodes.filter(n=>n.edges.length===1).map(n=>({p:pixel(n.p),walkway:[...n.lines].map(i=>walkways[i].id),joinsRoad:roadAt(n.p)??null}));
const result={source:connections.source,status:connections.status,roads,walkways,bounds,junctions:junctions.map(j=>({...j,p:pixel(j.p)})),
  surfaces:{asphalt:toPixels(asphaltOther),asphaltArterial:toPixels(asphaltArterial),asphaltLocal:toPixels(asphaltLocal),footpaths:toPixels(footpaths),kerbs:toPixels(kerbs),medians:toPixels(medians),edgePaint:toPixels(edgePaint),serviceRoads:toPixels(serviceRoads),walkways:toPixels(walkPaving)},
  topology:{components:roadNetwork.components.length,junctions:junctions.length,segments:roadNetwork.edges.length,openEnds:openEnds(roadNetwork,roads,'road')},
  walkwayTopology:{components:walkNetwork.components.length,junctions:walkNetwork.junctions.length,segments:walkNetwork.edges.length,openEnds:walkwayEnds},
  // Photo-traced areas (z18 pixels in the source) in reference pixels like everything else here.
  treeCover:(connections.treeCover??[]).map(t=>({id:t.id,points:t.points.map(p=>pixel(fromSatellite(p)))})),
  groundSurfaces:(connections.surfaces??[]).map(s=>({id:s.id,type:s.type,points:s.points.map(p=>pixel(fromSatellite(p)))}))};
fs.writeFileSync(path.join(work,'roads-prepared.json'),JSON.stringify(result));
console.log(JSON.stringify({roads:roads.length,...result.topology,openEnds:result.topology.openEnds.length,walkways:walkways.length,treeCover:result.treeCover.length,groundSurfaces:result.groundSurfaces.length,walkwayComponents:result.walkwayTopology.components,walkwayRoadJoins:walkwayEnds.filter(e=>e.joinsRoad).length,walkwayDeadEnds:walkwayEnds.filter(e=>!e.joinsRoad).length}));
