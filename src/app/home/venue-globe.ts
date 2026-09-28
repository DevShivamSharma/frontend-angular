/* Geographic context. Local frame: east +X, up +Y, south +Z.
 * Sources and limitations: geography/ATTRIBUTION.md, work/venue/globe-notes.md.
 */
import * as T from 'three';
import { createVenueGlobeMarker } from './venue-globe-marker';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VenueAppearance } from './venue-appearance';


type Mode = 'venue' | 'globe';
interface Pose { position: T.Vector3; target: T.Vector3; }
interface Flight { time: number; duration: number; from: T.Vector3; targetFrom: T.Vector3; to: T.Vector3; target: T.Vector3; fromAltitude: number; toAltitude: number; direction: T.Vector3; rotation: T.Quaternion; destination: Mode; }
type Kind = 'road' | 'building' | 'water' | 'park';
interface Geography { features: { k: Kind; p: [number, number][]; w?: number; h?: number; holes?: [number, number][][] }[]; }
interface GlobeOptions { scene: T.Scene; camera: T.PerspectiveCamera; controls: OrbitControls; renderer: T.WebGLRenderer; signal: AbortSignal; asset: (path: string) => string; onModeChange: (mode: Mode) => void; onInvalidate: () => void; onLocalMapReady?: () => void; markerElement?: HTMLElement; }

export async function createGlobeContext({scene,camera,controls,renderer,signal,asset,onModeChange,onInvalidate,onLocalMapReady,markerElement}: GlobeOptions) {
  const R=6371000, center=new T.Vector3(0,-R-8,0), localBackground=scene.background instanceof T.Color ? scene.background.clone() : new T.Color('#e5e7e5');
  const naturalBackground = localBackground.clone();
  const skyBackground = new T.Color('#17232c'), background = localBackground.clone();
  const flightRotation = new T.Quaternion(), flightDirection = new T.Vector3();
  scene.background = background;
  const group=new T.Group();group.name='Geographic context — Delhi to Earth';scene.add(group);
  const earthGroup=new T.Group();earthGroup.position.copy(center);earthGroup.visible=false;group.add(earthGroup);
  const groundGroup=new T.Group();groundGroup.name='OpenStreetMap Delhi context';group.add(groundGroup);
  // Put the local map at campus grade instead of seven metres below it. Only
  // this flat context moves; Earth and all geographic X/Z coordinates are kept.
  groundGroup.position.y = 6.6;
  const lat=28.6185*Math.PI/180,lon=77.2440*Math.PI/180;
  const east=new T.Vector3(-Math.sin(lon),0,-Math.cos(lon));
  const up=new T.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon));
  const north=new T.Vector3(-Math.sin(lat)*Math.cos(lon),Math.cos(lat),Math.sin(lat)*Math.sin(lon));
  const geographicRotation=new T.Matrix4().set(east.x,east.y,east.z,0,up.x,up.y,up.z,0,-north.x,-north.y,-north.z,0,0,0,0,1);
  const globeMaterial=new T.MeshStandardMaterial({color:0xe4e9e6,roughness:1,metalness:0,envMapIntensity:.3});
  const earthSaturation = { value: .36 };
  globeMaterial.onBeforeCompile=shader=>{
    shader.uniforms['earthSaturation'] = earthSaturation;
    shader.fragmentShader = 'uniform float earthSaturation;\n' + shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float luminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=mix(vec3(luminance),diffuseColor.rgb,earthSaturation);`);
  };
  const earthGeometry=new T.SphereGeometry(R,144,96);earthGeometry.applyMatrix4(geographicRotation);
  const earth=new T.Mesh(earthGeometry,globeMaterial);earth.name='Earth — geographically oriented';earthGroup.add(earth);
  new T.TextureLoader().load(asset('geography/earth-day.jpg'),texture=>{if(signal.aborted){texture.dispose();return;}texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());globeMaterial.map=texture;globeMaterial.needsUpdate=true;onInvalidate();},undefined,error=>console.warn('Earth texture unavailable',error));
  const atmosphereMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.BackSide,blending:T.AdditiveBlending,uniforms:{tint:{value:new T.Color('#7fa5c2')}},vertexShader:`varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`uniform vec3 tint;varying vec3 vN;varying vec3 vV;void main(){float rim=pow(1.-abs(dot(normalize(vN),normalize(vV))),3.);gl_FragColor=vec4(tint,rim*.24);}`});
  const atmosphere=new T.Mesh(new T.SphereGeometry(R*1.017,96,64),atmosphereMaterial);earthGroup.add(atmosphere);
  const globeLight=new T.DirectionalLight(0xf5f7ff,2.5);globeLight.position.set(-R*2,R*4,R*2);globeLight.target.position.copy(center);earthGroup.add(globeLight);scene.add(globeLight.target);
  const globeFill=new T.HemisphereLight(0xc7d9e9,0x172735,1.15);earthGroup.add(globeFill);
  // A quiet, flat map keeps the authored campus as the only detailed 3D subject.
  // Unlit colours stay legible in both lighting modes and need no shadow passes.
  const mapGround = new T.Color('#858b80');
  const groundMaterial = new T.MeshBasicMaterial({color:mapGround,transparent:true,toneMapped:false});
  const ground=new T.Mesh(new T.CircleGeometry(14000,128),groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-7;groundGroup.add(ground);
  function mapMaterial(color: string) {
    const material = new T.MeshBasicMaterial({color,transparent:true,toneMapped:false});
    material.onBeforeCompile = shader => {
      shader.uniforms['mapGround'] = { value: mapGround };
      shader.vertexShader = 'varying vec2 vMapPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vMapPosition = (modelMatrix * vec4(transformed, 1.0)).xz;`);
      shader.fragmentShader = 'varying vec2 vMapPosition;\nuniform vec3 mapGround;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, mapGround, smoothstep(1800.0, 3500.0, length(vMapPosition)));`);
    };
    return material;
  }
  const contextMaterials = {
    road: mapMaterial('#b6baad'),
    building: mapMaterial('#959b8c'),
    water: mapMaterial('#719095'),
    park: mapMaterial('#71876b')
  };
  const mapPalettes = {
    natural: { ground: '#858b80', road: '#b6baad', building: '#959b8c', water: '#719095', park: '#71876b' },
    color: { ground: '#b5bc99', road: '#e2dbc5', building: '#b9af99', water: '#5b9fac', park: '#719f57' }
  };
  function setAppearance(appearance: VenueAppearance) {
    const palette = mapPalettes[appearance];
    // Reuse all map geometry and the shader's shared fade colour. Updating this
    // once per explicit switch also covers geography/Earth textures arriving late.
    mapGround.set(palette.ground); groundMaterial.color.copy(mapGround);
    for (const kind of Object.keys(contextMaterials) as Kind[]) contextMaterials[kind].color.set(palette[kind]);
    earthSaturation.value = appearance === 'color' ? 1 : .36;
    if (appearance === 'color') localBackground.set('#b9c9cd'); else localBackground.copy(naturalBackground);
    onInvalidate();
  }
  // Keep the existing OSM coordinates and road widths. Fade distant data into the
  // ground spatially, never by switching quality after an interaction stops.
  fetch(asset('geography/delhi-context.json'),{signal}).then(r=>{if(!r.ok)throw Error(String(r.status));return r.json();}).then((data:Geography)=>{if(signal.aborted)return;
    const bins:Record<Kind,T.BufferGeometry[]>={road:[],building:[],water:[],park:[]};
    for(const f of data.features){
      let geometry;
      if(f.k==='road' && f.p.length === 2){
        const [a,b]=f.p,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.2)continue;
        geometry=new T.PlaneGeometry(f.w ?? 8,length);geometry.rotateX(-Math.PI/2);geometry.rotateY(Math.atan2(dx,dz));geometry.translate((a[0]+b[0])/2,-6.6,(a[1]+b[1])/2);
      }else{
        const shape=new T.Shape(f.p.map(p=>new T.Vector2(p[0],-p[1])));
        // Nearby features are clipped offline against the real campus outline.
        // Preserve interior rings so a park cannot fill the excluded campus.
        for (const hole of f.holes ?? []) shape.holes.push(new T.Path(hole.map(p=>new T.Vector2(p[0],-p[1]))));
        geometry=new T.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI/2);geometry.translate(0,f.k==='building'?-6.3:f.k==='road'?-6.6:f.k==='water'?-6.8:-6.9,0);
      }
      if(geometry.index){const indexed=geometry;geometry=geometry.toNonIndexed();indexed.dispose();}
      bins[f.k].push(geometry);
    }
    for(const [kind,geometries]of Object.entries(bins))if(geometries.length){
      const combined=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!combined)continue;
      const mesh=new T.Mesh(combined,contextMaterials[kind as Kind]);mesh.name='OSM Delhi '+kind;groundGroup.add(mesh);
    }
    if (bins.road.length) onLocalMapReady?.();
    onInvalidate();
  }).catch(error=>{if(!signal.aborted)console.warn('Delhi context unavailable',error);});
  const updateMarker = markerElement
    ? createVenueGlobeMarker(markerElement, camera, renderer.domElement, center, R, signal) : undefined;
  let mode:Mode='venue',transition:Flight|null=null,armedAt=performance.now()+1800,lastLocal:Pose|null=null;
  // Automatic departure/return must still run when controls settle before the cooldown ends.
  let armTimer: number | undefined;
  function armNavigation(delay: number) {
    armedAt = performance.now() + delay;
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(() => { if (!signal.aborted) onInvalidate(); }, delay + 1);
  }
  signal.addEventListener('abort', () => window.clearTimeout(armTimer), { once: true });
  armNavigation(1800);
  const initial={minDistance:controls.minDistance,maxPolarAngle:controls.maxPolarAngle,minPolarAngle:controls.minPolarAngle,zoomSpeed:controls.zoomSpeed,enablePan:controls.enablePan};
  controls.maxDistance=R*7;
  const copyVector=(v:T.Vector3|[number,number,number]|undefined,fallback:T.Vector3)=>v instanceof T.Vector3?v.clone():Array.isArray(v)?new T.Vector3(...v):fallback.clone();
  function localLimits(){controls.minDistance=initial.minDistance;controls.maxPolarAngle=initial.maxPolarAngle;controls.minPolarAngle=initial.minPolarAngle;controls.zoomSpeed=initial.zoomSpeed;controls.enablePan=initial.enablePan;}
  function startFlight(destination:Mode,position:T.Vector3,target:T.Vector3){
    const from=camera.position.clone(),to=position.clone(),a=from.clone().sub(center),b=to.clone().sub(center);
    const fromAltitude=Math.max(25,a.length()-R),toAltitude=Math.max(25,b.length()-R),rotation=new T.Quaternion().setFromUnitVectors(a.clone().normalize(),b.clone().normalize());
    transition={time:performance.now(),duration:2600,from,targetFrom:controls.target.clone(),to,target,fromAltitude,toAltitude,direction:a.normalize(),rotation,destination};
    controls.enabled=false;mode=destination;onModeChange(mode);onInvalidate();
  }
  function rememberVenuePose(position:T.Vector3,target:T.Vector3){
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
  function goVenue(options:Partial<Pose>={}){
    const fallback=lastLocal||{position:new T.Vector3(740,800,930),target:new T.Vector3(0,0,0)};
    const position=copyVector(options.position,fallback.position),target=copyVector(options.target,fallback.target);
    // A broad view is saved at automatic departure; cap the return so it cannot immediately retrigger.
    if(position.distanceTo(target)>2800)position.sub(target).setLength(1800).add(target);
    if(mode==='venue'&&!transition){localLimits();camera.position.copy(position);controls.target.copy(target);controls.update();armNavigation(1500);onInvalidate();return;}
    localLimits();startFlight('venue',position,target);
  }
  function update(){
    const now=performance.now();
    if(transition){
      const f=transition,k=Math.min(1,(now-f.time)/f.duration),e=k*k*(3-2*k);
      const altitude=Math.exp(T.MathUtils.lerp(Math.log(f.fromAltitude),Math.log(f.toAltitude),e));
      const q=flightRotation.identity().slerp(f.rotation,e),direction=flightDirection.copy(f.direction).applyQuaternion(q);
      camera.position.copy(center).addScaledVector(direction,R+altitude);
      controls.target.lerpVectors(f.targetFrom,f.target,e);camera.lookAt(controls.target);
      if(k===1){
        camera.position.copy(f.to);controls.target.copy(f.target);transition=null;controls.enabled=true;armNavigation(1800);
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
    updateMarker?.(mode === 'globe' && !transition && altitude > 180000);
    background.copy(localBackground).lerp(skyBackground,planetMix);
    const near=altitude>15000?Math.max(5,altitude/1800):Math.max(1,Math.min(32,distance/55));
    const far=altitude>4800?R*18:12000;
    if(Math.abs(camera.near-near)>.02||camera.far!==far){camera.near=near;camera.far=far;camera.updateProjectionMatrix();}
    if(!transition&&now>armedAt){
      if(mode==='venue'&&(distance>4600||(Math.hypot(controls.target.x,controls.target.z)>1900&&distance>550)))goGlobe();
      else if(mode==='globe'&&distance<R*1.19&&camera.position.clone().sub(center).normalize().y>.72)goVenue();
    }
  }
  return{update,goGlobe,goVenue,setAppearance,get isGlobe(){return mode==='globe'},get transitioning(){return!!transition},get mode(){return mode},group,center,radius:R,attribution:'Earth: NASA Earth Observatory · © OpenStreetMap contributors'};
}
