/* Geographic context. Local frame: east +X, up +Y, south +Z.
 * Sources and limitations: geography/ATTRIBUTION.md, work/venue/globe-notes.md.
 */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export async function createGlobeContext({THREE:T,scene,camera,controls,renderer,root,signal,asset,onModeChange=()=>{}}) {
  const R=6371000, center=new T.Vector3(0,-R-8,0), localBackground=scene.background?.clone?.()||new T.Color('#e5e7e5');
  const group=new T.Group();group.name='Geographic context — Delhi to Earth';scene.add(group);
  const earthGroup=new T.Group();earthGroup.position.copy(center);earthGroup.visible=false;group.add(earthGroup);
  const groundGroup=new T.Group();groundGroup.name='OpenStreetMap Delhi context';group.add(groundGroup);
  const lat=28.6185*Math.PI/180,lon=77.2440*Math.PI/180;
  const east=new T.Vector3(-Math.sin(lon),0,-Math.cos(lon));
  const up=new T.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon));
  const north=new T.Vector3(-Math.sin(lat)*Math.cos(lon),Math.cos(lat),Math.sin(lat)*Math.sin(lon));
  const geographicRotation=new T.Matrix4().set(east.x,east.y,east.z,0,up.x,up.y,up.z,0,-north.x,-north.y,-north.z,0,0,0,0,1);
  const globeMaterial=new T.MeshStandardMaterial({color:0xe4e9e6,roughness:1,metalness:0,envMapIntensity:.3});
  globeMaterial.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float luminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=mix(vec3(luminance),diffuseColor.rgb,.36);`);
  };
  const earthGeometry=new T.SphereGeometry(R,144,96);earthGeometry.applyMatrix4(geographicRotation);
  const earth=new T.Mesh(earthGeometry,globeMaterial);earth.name='Earth — geographically oriented';earthGroup.add(earth);
  new T.TextureLoader().load(asset('geography/earth-day.jpg'),texture=>{if(signal.aborted){texture.dispose();return;}texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());globeMaterial.map=texture;globeMaterial.needsUpdate=true;},undefined,error=>console.warn('Earth texture unavailable',error));
  const atmosphereMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.BackSide,blending:T.AdditiveBlending,uniforms:{tint:{value:new T.Color('#7fa5c2')}},vertexShader:`varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`uniform vec3 tint;varying vec3 vN;varying vec3 vV;void main(){float rim=pow(1.-abs(dot(normalize(vN),normalize(vV))),3.);gl_FragColor=vec4(tint,rim*.24);}`});
  const atmosphere=new T.Mesh(new T.SphereGeometry(R*1.017,96,64),atmosphereMaterial);earthGroup.add(atmosphere);
  const globeLight=new T.DirectionalLight(0xf5f7ff,2.5);globeLight.position.set(-R*2,R*4,R*2);globeLight.target.position.copy(center);earthGroup.add(globeLight);scene.add(globeLight.target);
  const globeFill=new T.HemisphereLight(0xc7d9e9,0x172735,1.15);earthGroup.add(globeFill);
  const groundMaterial=new T.MeshStandardMaterial({color:0x606b66,roughness:1,transparent:true});
  const ground=new T.Mesh(new T.CircleGeometry(14000,128),groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-7;ground.receiveShadow=true;groundGroup.add(ground);
  const contextMaterials={
    road:new T.MeshStandardMaterial({color:0x48514e,roughness:1,transparent:true}),
    building:new T.MeshStandardMaterial({color:0x727b78,roughness:1,transparent:true}),
    water:new T.MeshStandardMaterial({color:0xa6b6b5,roughness:.65,transparent:true}),
    park:new T.MeshStandardMaterial({color:0x576c58,roughness:1,transparent:true})
  };
  // These are actual OSM outlines; default heights are deliberately neutral massing.
  fetch(asset('geography/delhi-context.json'),{signal}).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(data=>{if(signal.aborted)return;
    const bins={road:[],building:[],water:[],park:[]};
    for(const f of data.features){
      let geometry;
      if(f.k==='road'){
        const [a,b]=f.p,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.2)continue;
        geometry=new T.PlaneGeometry(f.w,length);geometry.rotateX(-Math.PI/2);geometry.rotateY(Math.atan2(dx,dz));geometry.translate((a[0]+b[0])/2,-6.6,(a[1]+b[1])/2);
      }else{
        const shape=new T.Shape(f.p.map(p=>new T.Vector2(p[0],-p[1])));
        geometry=f.k==='building'?new T.ExtrudeGeometry(shape,{depth:f.h,bevelEnabled:false,steps:1}):new T.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI/2);geometry.translate(0,f.k==='building'?-6.3:f.k==='water'?-6.8:-6.9,0);
      }
      if(geometry.index){const indexed=geometry;geometry=geometry.toNonIndexed();indexed.dispose();}
      bins[f.k].push(geometry);
    }
    for(const [kind,geometries]of Object.entries(bins))if(geometries.length){
      const combined=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!combined)continue;
      const mesh=new T.Mesh(combined,contextMaterials[kind]);mesh.name='OSM Delhi '+kind;mesh.receiveShadow=true;mesh.castShadow=false;groundGroup.add(mesh);
    }
  }).catch(error=>{if(!signal.aborted)console.warn('Delhi context unavailable',error);});
  // A geographic destination marker, never a replacement for roof labels.
  const marker=new T.Group();marker.position.set(0,38000,0);marker.visible=false;group.add(marker);
  const pin=new T.Mesh(new T.SphereGeometry(20000,24,16),new T.MeshBasicMaterial({color:0xe0af62}));marker.add(pin);
  const ring=new T.Mesh(new T.TorusGeometry(46000,3400,8,64),new T.MeshBasicMaterial({color:0xf3dab3,transparent:true,opacity:.7}));ring.rotation.x=-Math.PI/2;marker.add(ring);
  const credit=root.querySelector('#geo-credit');
  credit.id='geo-credit';credit.hidden=false;
  credit.innerHTML='<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/" target="_blank" rel="noopener">Earth: NASA</a>';
  let mode='venue',transition=null,armedAt=performance.now()+1800,lastLocal=null;
  const initial={minDistance:controls.minDistance,maxPolarAngle:controls.maxPolarAngle,minPolarAngle:controls.minPolarAngle,zoomSpeed:controls.zoomSpeed,enablePan:controls.enablePan};
  controls.maxDistance=R*7;
  const copyVector=(v,fallback)=>v?.isVector3?v.clone():Array.isArray(v)?new T.Vector3(...v):fallback.clone();
  function localLimits(){controls.minDistance=initial.minDistance;controls.maxPolarAngle=initial.maxPolarAngle;controls.minPolarAngle=initial.minPolarAngle;controls.zoomSpeed=initial.zoomSpeed;controls.enablePan=initial.enablePan;}
  function startFlight(destination,position,target){
    const from=camera.position.clone(),to=position.clone(),a=from.clone().sub(center),b=to.clone().sub(center);
    const fromAltitude=Math.max(25,a.length()-R),toAltitude=Math.max(25,b.length()-R),rotation=new T.Quaternion().setFromUnitVectors(a.clone().normalize(),b.clone().normalize());
    transition={time:performance.now(),duration:2600,from,targetFrom:controls.target.clone(),to,target,fromAltitude,toAltitude,direction:a.normalize(),rotation,destination};
    controls.enabled=false;mode=destination;onModeChange(mode);
  }
  function rememberVenuePose(position,target){
    const pose={position:position.clone(),target:target.clone()};
    // Only local destinations may be retained. A geographic flight's target is below the surface.
    if(![...pose.position.toArray(),...pose.target.toArray()].every(Number.isFinite)||Math.abs(pose.target.y)>500||pose.position.y<0){
      lastLocal={position:new T.Vector3(740,800,930),target:new T.Vector3(0,0,0)};return;
    }
    if(Math.hypot(pose.target.x,pose.target.z)>1000){pose.position.sub(pose.target).setLength(1800);pose.target.set(0,0,0);}
    lastLocal=pose;
  }
  function goGlobe(){
    // Repeated clicks during an outward flight must not restart its clock.
    if(mode==='globe')return;
    if(transition?.destination==='venue')rememberVenuePose(transition.to,transition.target);
    else rememberVenuePose(camera.position,controls.target);
    const halfFov=T.MathUtils.degToRad(camera.fov/2),fitAngle=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));
    const desired=center.clone().add(new T.Vector3(.50,2.72,.38).normalize().multiplyScalar(R/Math.sin(fitAngle)*1.08));
    startFlight('globe',desired,center.clone());
  }
  function goVenue(options={}){
    const fallback=lastLocal||{position:new T.Vector3(740,800,930),target:new T.Vector3(0,0,0)};
    const position=copyVector(options.position,fallback.position),target=copyVector(options.target,fallback.target);
    // A broad view is saved at automatic departure; cap the return so it cannot immediately retrigger.
    if(position.distanceTo(target)>2800)position.sub(target).setLength(1800).add(target);
    if(mode==='venue'&&!transition){localLimits();camera.position.copy(position);controls.target.copy(target);controls.update();armedAt=performance.now()+1500;return;}
    localLimits();startFlight('venue',position,target);
  }
  let pointerDown=null;
  renderer.domElement.addEventListener('pointerdown',event=>{pointerDown=[event.clientX,event.clientY];},{signal});
  renderer.domElement.addEventListener('pointerup',event=>{
    if(mode!=='globe'||transition||!pointerDown||Math.hypot(event.clientX-pointerDown[0],event.clientY-pointerDown[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect(),mouse=new T.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),ray=new T.Raycaster();ray.setFromCamera(mouse,camera);
    const markerHit=ray.intersectObject(marker,true)[0];if(!markerHit)return;
    const earthHit=ray.intersectObject(earth,false)[0];
    if(!earthHit||markerHit.distance<earthHit.distance)goVenue();
  },{signal});
  function update(){
    const now=performance.now();
    if(transition){
      const f=transition,k=Math.min(1,(now-f.time)/f.duration),e=k*k*(3-2*k);
      const altitude=Math.exp(T.MathUtils.lerp(Math.log(f.fromAltitude),Math.log(f.toAltitude),e));
      const q=new T.Quaternion().slerp(f.rotation,e),direction=f.direction.clone().applyQuaternion(q);
      camera.position.copy(center).addScaledVector(direction,R+altitude);
      controls.target.lerpVectors(f.targetFrom,f.target,e);camera.lookAt(controls.target);
      if(k===1){
        camera.position.copy(f.to);controls.target.copy(f.target);transition=null;controls.enabled=true;armedAt=now+1800;
        if(mode==='globe'){controls.minDistance=R*1.08;controls.maxPolarAngle=Math.PI-.001;controls.minPolarAngle=.001;controls.zoomSpeed=1.25;controls.enablePan=false;}else localLimits();
        // Drain OrbitControls' pending damping so the flight cannot inherit an earlier drag.
        const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
      }
    }
    const altitude=Math.max(1,camera.position.distanceTo(center)-R),distance=camera.position.distanceTo(controls.target);
    const planetMix=T.MathUtils.smoothstep(altitude,12000,380000);
    earthGroup.visible=altitude>4800;
    groundGroup.visible=altitude<80000;
    const groundOpacity=1-T.MathUtils.smoothstep(altitude,9000,45000);groundMaterial.opacity=groundOpacity;
    Object.values(contextMaterials).forEach(m=>m.opacity=groundOpacity);
    marker.visible=altitude>180000;const markerScale=Math.max(.6,Math.min(12,altitude/R*2));marker.scale.setScalar(markerScale);
    scene.background=localBackground.clone().lerp(new T.Color('#17232c'),planetMix);
    const near=altitude>15000?Math.max(5,altitude/1800):Math.max(1,Math.min(32,distance/55));
    const far=altitude>4800?R*18:12000;
    if(Math.abs(camera.near-near)>.02||camera.far!==far){camera.near=near;camera.far=far;camera.updateProjectionMatrix();}
    if(!transition&&now>armedAt){
      if(mode==='venue'&&(distance>4600||(Math.hypot(controls.target.x,controls.target.z)>1900&&distance>550)))goGlobe();
      else if(mode==='globe'&&distance<R*1.19&&camera.position.clone().sub(center).normalize().y>.72)goVenue();
    }
  }
  return{update,goGlobe,goVenue,get isGlobe(){return mode==='globe'},get transitioning(){return!!transition},get mode(){return mode},group,center,radius:R,attribution:'Earth: NASA Earth Observatory · © OpenStreetMap contributors'};
}
