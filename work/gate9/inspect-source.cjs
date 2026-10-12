const fs=require('node:fs'),T=require('three');
const bytes=fs.readFileSync('src/assets/venue/IITF_2026_ARCHITECTURAL.glb');
const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const parents=new Map();gltf.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>parents.set(c,i)));
const matrices=new Map();
function matrix(i){if(matrices.has(i))return matrices.get(i);const n=gltf.nodes[i],m=n.matrix?new T.Matrix4().fromArray(n.matrix):new T.Matrix4().compose(new T.Vector3(...(n.translation??[0,0,0])),new T.Quaternion(...(n.rotation??[0,0,0,1])),new T.Vector3(...(n.scale??[1,1,1])));if(parents.has(i))m.premultiply(matrix(parents.get(i)));matrices.set(i,m);return m;}
const local=p=>[.5*p[0]-.8660254038*p[2],.8660254038*p[0]+.5*p[2],p[1]].map(x=>+x.toFixed(3));
const result=[];
gltf.nodes.forEach((n,i)=>{if(n.mesh===undefined||!/GATE_9|ITPO office|PHOTO_ADMIN/.test(n.name??''))return;const box=new T.Box3();for(const p of gltf.meshes[n.mesh].primitives){const a=gltf.accessors[p.attributes.POSITION];for(const x of[a.min[0],a.max[0]])for(const y of[a.min[1],a.max[1]])for(const z of[a.min[2],a.max[2]])box.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(matrix(i)));}const center=box.getCenter(new T.Vector3()).toArray();result.push({name:n.name,worldMin:box.min.toArray(),worldMax:box.max.toArray(),localCenter:local(center),localCorners:[...Array(8)].map((_,i)=>local([i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z]))});});
fs.writeFileSync('work/gate9/existing-geometry.json',JSON.stringify(result,null,2));
console.log(result.map(r=>({name:r.name,localCenter:r.localCenter,worldSize:r.worldMax.map((v,i)=>+(v-r.worldMin[i]).toFixed(2))})));
