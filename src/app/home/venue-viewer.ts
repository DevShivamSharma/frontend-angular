import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGlobeContext } from './venue-globe';
import { Triple, Destination, VenueInformation, venueAsset } from './venue.models';
type VenueMesh = T.Mesh<T.BufferGeometry, T.MeshStandardMaterial | T.MeshStandardMaterial[]>;
interface Tween { start:number; duration:number; a:T.Vector3; b:T.Vector3; p:T.Vector3; t:T.Vector3; }
interface ViewerEvents { progress:(fraction:number)=>void; selected:(id:string,level:number)=>void; modeChanged:(mode:'venue'|'globe')=>void; status:(text:string)=>void; geographyReady:(ready:boolean)=>void; }
export interface VenueViewer { ready:Promise<VenueInformation>; view:(id:string)=>void; selectLevel:(level:number)=>void; goGlobe:()=>void; zoom:(factor:number)=>void; setDaylight:(enabled:boolean)=>void; readonly isGlobe:boolean; dispose:()=>void; }
/** Direct port of outputs/venue-explorer.js; values and event behavior follow that source. */
export function createVenueViewer(canvas: HTMLCanvasElement, loadInformation: () => Promise<VenueInformation>, events: ViewerEvents): VenueViewer {
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const cleanups: (() => void)[] = [];
    const asset = venueAsset;
    const listen = <K extends keyof WindowEventMap>(type: K, callback: (event: WindowEventMap[K]) => void) => window.addEventListener(type, callback, { signal });
    let viewCommand = (_id:string) => {}, levelCommand = (_level:number) => {}, globeCommand = () => {}, zoomCommand = (_factor:number) => {}, lightCommand = (_enabled:boolean) => {}, isGlobe = () => false;
    const ready = initializeVenue();
    return { ready, view:id=>viewCommand(id), selectLevel:n=>levelCommand(n), goGlobe:()=>globeCommand(), zoom:f=>zoomCommand(f), setDaylight:d=>lightCommand(d), get isGlobe(){return isGlobe();}, dispose:()=>{lifetime.abort();for(const cleanup of cleanups.reverse())cleanup();} };
    async function initializeVenue() {
        signal.throwIfAborted();
        const scene = new T.Scene();
        cleanups.push(() => disposeScene(scene));
        scene.background = new T.Color('#8b9391');
        const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setSize(innerWidth, innerHeight);
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.toneMapping = T.AgXToneMapping;
        renderer.toneMappingExposure = .86;
        renderer.localClippingEnabled = true;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;
        cleanups.push(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); });
        const camera = new T.PerspectiveCamera(40, innerWidth / innerHeight, 1, 5e7);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = .085;
        controls.maxPolarAngle = Math.PI * .46;
        controls.minDistance = 32;
        controls.maxDistance = 5e7;
        controls.zoomSpeed = .9;
        controls.panSpeed = .7;
        controls.rotateSpeed = .6;
        cleanups.push(() => controls.dispose());
        const pmrem = new T.PMREMGenerator(renderer);
        const roomEnvironment = new RoomEnvironment();
        const environment = pmrem.fromScene(roomEnvironment, .04);
        scene.environment = environment.texture;
        roomEnvironment.dispose();
        pmrem.dispose();
        cleanups.push(() => environment.dispose());
        scene.environmentIntensity = .32;
        const hemi = new T.HemisphereLight(0xe0eaff, 0x4d514a, .38);
        scene.add(hemi);
        const sun = new T.DirectionalLight(0xffefda, 4.5);
        sun.position.set(-550, 430, 300);
        sun.castShadow = true;
        sun.shadow.mapSize.set(4096, 4096);
        Object.assign(sun.shadow.camera, { left: -770, right: 770, top: 770, bottom: -770, near: 50, far: 1800 });
        sun.shadow.bias = -.00008;
        sun.shadow.normalBias = 1.1;
        sun.shadow.radius = 3;
        sun.shadow.camera.updateProjectionMatrix();
        scene.add(sun);
        const fill = new T.DirectionalLight(0xbacfff, .25);
        fill.position.set(600, 260, -400);
        scene.add(fill);
        const renderTarget = new T.WebGLRenderTarget(innerWidth, innerHeight, { type: T.HalfFloatType });
        renderTarget.samples = 4;
        const composer = new EffectComposer(renderer, renderTarget);
        composer.addPass(new RenderPass(scene, camera));
        const ao = new SSAOPass(scene, camera, innerWidth, innerHeight, 32);
        ao.kernelRadius = 6;
        ao.minDistance = .00001;
        ao.maxDistance = .001;
        composer.addPass(ao);
        const bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), .19, .65, 1.15);
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
        cleanups.push(() => { for (const pass of composer.passes)
            pass.dispose(); composer.dispose(); });
        const W = (s: number, t: number, z: number) => new T.Vector3(.5 * s + .8660254038 * t, z, -.8660254038 * s + .5 * t);
        const views: Record<string, {
            p: Triple;
            t: Triple;
        }> = { overview: { p: [-720, 600, 640], t: [-65, 12, 0] }, cc: { p: [-350, -20, 112], t: [-284, -228, 23] }, fountain: { p: [-295, 276, 95], t: [-201, 182, 0] } };
        let root: T.Group | undefined, tween: Tween | null = null, level = 0, globe: Awaited<ReturnType<typeof createGlobeContext>> | undefined;
        const ccMaterials: T.MeshStandardMaterial[] = [], originals = new Map<T.Object3D, {
            color: T.Color;
            emissive: T.Color;
            emissiveIntensity: number;
        }[]>();
        const information = await loadInformation();
        signal.throwIfAborted();
        const { destinations } = information;
        const hallIds = new Set(destinations.filter(d => d.hall).map(d => String(d.hall)));
        function ancestorMatches(o: T.Object3D, re: RegExp) { for (let n: T.Object3D | null = o; n; n = n.parent)
            if (re.test(n.name))
                return true; return false; }
        function classify(o: T.Object3D) { for (let n: T.Object3D | null = o; n; n = n.parent) {
            if (n.userData?.['hall'] && hallIds.has(String(n.userData['hall'])))
                return 'hall' + n.userData['hall'];
            const h = n.name.match(/^(?:PHOTO_)?HALL_(12A|14|12|11|10|[1-9])(?:[ _]|$)|^ROOF_LABEL_H(12A|14|12|11|10|[1-9])$/);
            if (h)
                return 'hall' + (h[1] || h[2]);
            const sign = n.name.match(/^(?:ARCH_H|PHOTO_ROOF_SIGN_BOARD_H)(12A|14|12|11|10|[1-9])(?:_SIGN)?$/);
            if (sign)
                return 'hall' + sign[1];
            if (/^PHOTO_MUSICAL_FOUNTAIN/.test(n.name))
                return 'fountain';
            if (/^PHOTO_CC|^ROOF_LABEL_CC|^ARCH_CC/.test(n.name))
                return 'cc';
        } return null; }
        function highlight(id: string) { if (!root)
            return; root.traverse(o => { if (!(o instanceof T.Mesh) || !originals.has(o))
            return; const mats = Array.isArray(o.material) ? o.material : [o.material], base = originals.get(o)!; mats.forEach((m: T.MeshStandardMaterial, i: number) => { m.color.copy(base[i].color); m.emissive?.copy(base[i].emissive); m.emissiveIntensity = base[i].emissiveIntensity; }); if (classify(o) === id && !/label|sign|glass|glazing|light|spray/i.test(o.name) && id !== 'fountain') {
            mats.forEach((m: T.MeshStandardMaterial) => { if (!['glazing', 'water', 'water_spray', 'roof_label', 'conceptual_edge_light', 'supplied_floor_plan'].includes(m.userData['architecturalCategory']))
                m.color.lerp(new T.Color('#ac7855'), .25); });
        } }); }
        function resetLevel() {
            level = 0;
            root?.traverse(o => { if(o.userData['cc_level'])o.visible=false; });
            ccMaterials.forEach(m=>{m.clippingPlanes=[];m.needsUpdate=true;});
        }
        function fly(position: T.Vector3, target: T.Vector3, duration = 1350) { if (globe?.isGlobe || globe?.transitioning) {
            tween = null;
            globe.goVenue({ position, target });
            return;
        } tween = { start: performance.now(), duration, a: camera.position.clone(), b: controls.target.clone(), p: position, t: target }; }
        function view(id:string) {
            resetLevel();highlight(id);const v=views[id];if(!v)return;
            const target=W(...v.t),eye=W(...v.p);
            const radius=({overview:490,cc:110,hall1:70,hall14:70,hall6:86,hall11:74,hall12A:74,hall12:56,fountain:72} as Record<string,number>)[id]||62;
            const fit=radius/Math.tan(T.MathUtils.degToRad(camera.fov/2))*Math.max(.78,1/camera.aspect);
            if(eye.distanceTo(target)<fit)eye.sub(target).setLength(fit).add(target);
            fly(eye,target);
        }
        for(const d of destinations.filter(d=>d.hall).sort((a,b)=>parseInt(a.hall!)-parseInt(b.hall!)||a.hall!.localeCompare(b.hall!))){
            const [s,t,z]=d.center;views[d.id]={p:[s-105,t-120,z+105],t:[s,t,z*.45]};
            if(d.hall==='14')views[d.id].p=[s-95,t+125,z+95];
        }
        viewCommand=view;
        levelCommand=n=>{view('cc');level=n;};
        globeCommand=()=>{resetLevel();tween=null;globe?.goGlobe();};
        isGlobe=()=>!!globe?.isGlobe;
        zoomCommand=f=>{if(globe?.transitioning)return;tween=null;camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update();};
        lightCommand=daylight=>{sun.intensity=daylight?3.8:4.5;hemi.intensity=daylight?1.3:.38;renderer.toneMappingExposure=daylight?1.05:.86;scene.environmentIntensity=daylight?.6:.32;bloom.strength=daylight?.075:.19;};
        controls.addEventListener('start', () => { tween = null; });
        camera.position.copy(W(...views['overview'].p));
        controls.target.copy(W(...views['overview'].t));
        const initialFit = 510 / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.78, 1 / camera.aspect);
        camera.position.sub(controls.target).setLength(initialFit).add(controls.target);
        controls.update();
        try {
            globe=await createGlobeContext({scene,camera,controls,renderer,signal,asset,onModeChange:events.modeChanged});
            events.geographyReady(true);
        } catch(error) { if(!signal.aborted)console.warn('Geographic context unavailable',error);events.geographyReady(false); }
        signal.throwIfAborted();
        const g = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().load(asset('IITF_2026_ARCHITECTURAL.glb?v=cc-aerial-20260926-r5'), resolve, p => { if (p.total)
            events.progress(p.loaded / p.total * .95); }, reject));
        if (signal.aborted) {
            disposeScene(g.scene);
            signal.throwIfAborted();
        }
        root = g.scene;
        scene.add(root);
        root.traverse(o => { if (!(o instanceof T.Mesh))
            return; const sourceMaterials = Array.isArray(o.material) ? o.material : [o.material]; o.material = Array.isArray(o.material) ? o.material.map((m: T.Material) => m.clone()) : o.material.clone(); sourceMaterials.forEach((m: T.Material) => m.dispose()); const mats = Array.isArray(o.material) ? o.material : [o.material]; if (ancestorMatches(o, /^PHOTO_CC|^PHOTO_Swept|^PHOTO_Ramp|^PHOTO_ROOF_SIGN_BOARD_CC|^ROOF_LABEL_CC|^ARCH_CC_SIGN/))
            ccMaterials.push(...mats); o.castShadow = !ancestorMatches(o, /GROUND|paving|water|lawns|floor plan/i) && !mats.every((m: T.MeshStandardMaterial) => ['paved_ground', 'context_ground', 'water', 'road', 'road_marking', 'supplied_floor_plan'].includes(m.userData['architecturalCategory'])); o.receiveShadow = true; mats.forEach((m: T.MeshStandardMaterial) => { if (m.map)
            m.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }); originals.set(o, mats.map((m: T.MeshStandardMaterial) => ({ color: m.color.clone(), emissive: m.emissive?.clone() || new T.Color(0), emissiveIntensity: m.emissiveIntensity }))); if (o.userData['cc_level'])
            o.visible = false; });
        events.status('Bharat Mandapam');
        if (new URLSearchParams(location.search).get('view') === 'cc-forecourt') {
            camera.position.copy(W(10.685, 141.551, 220));
            controls.target.copy(W(-284.315, -123.449, 5));
            controls.update();
            events.status('Convention Centre · Forecourt');
        }
        const ray = new T.Raycaster(), pointer = new T.Vector2();
        let down: [
            number,
            number
        ] | undefined;
        renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, { signal });
        renderer.domElement.addEventListener('pointerup', e => { if (!root || !down || globe?.isGlobe || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
            return; pointer.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); ray.setFromCamera(pointer, camera); for (const hit of ray.intersectObject(root, true)) {
            let visible = true;
            for (let n: T.Object3D | null = hit.object; n; n = n.parent)
                if (!n.visible)
                    visible = false;
            if (!visible)
                continue;
            const material = (hit.object as VenueMesh).material;
            const mat = Array.isArray(material) ? material[hit.face!.materialIndex] : material;
            if (mat.clippingPlanes?.some((p: T.Plane) => p.distanceToPoint(hit.point) < 0))
                continue;
            const id = classify(hit.object);
            if (id) { events.selected(id, level); break; }
            if (!mat.transparent || mat.opacity > .9)
                break;
        } }, { signal });
        function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); composer.setSize(innerWidth, innerHeight); }
        listen('resize', resize);
        listen('pageshow', resize);
        renderer.setAnimationLoop(() => { if (tween) {
            let k = Math.min(1, (performance.now() - tween.start) / tween.duration);
            k = k * k * (3 - 2 * k);
            camera.position.lerpVectors(tween.a, tween.p, k);
            controls.target.lerpVectors(tween.b, tween.t, k);
            if (k >= 1)
                tween = null;
        } controls.update(); globe?.update(); const distant = camera.position.distanceTo(controls.target) > 5500; ao.enabled = !distant; bloom.enabled = !distant; if (distant)
            renderer.render(scene, camera);
        else {
            const u = ao.ssaoMaterial.uniforms;
            u['cameraNear'].value = camera.near;
            u['cameraFar'].value = camera.far;
            u['cameraProjectionMatrix'].value.copy(camera.projectionMatrix);
            u['cameraInverseProjectionMatrix'].value.copy(camera.projectionMatrixInverse);
            ao.depthRenderMaterial.uniforms['cameraNear'].value = camera.near;
            ao.depthRenderMaterial.uniforms['cameraFar'].value = camera.far;
            ao.minDistance = .12 / (camera.far - camera.near);
            ao.maxDistance = 10 / (camera.far - camera.near);
            composer.render();
        } });
        // Draw a prepared scene before releasing the welcome screen.
        signal.throwIfAborted();
        controls.update();
        composer.render();
        return information;
    }
}
/** Release shared textures once, including uniforms and shadow render targets. */
function disposeScene(scene: T.Object3D): void {
    const textures = new Set<T.Texture>(), materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
    scene.traverse(object => {
        if (object instanceof T.Mesh) {
            geometries.add(object.geometry);
            for (const material of Array.isArray(object.material) ? object.material : [object.material])
                materials.add(material);
        }
        if (object instanceof T.Light && 'shadow' in object)
            (object as T.DirectionalLight).shadow.dispose();
    });
    for (const material of materials) {
        for (const value of Object.values(material))
            if (value instanceof T.Texture)
                textures.add(value);
        if (material instanceof T.ShaderMaterial)
            for (const uniform of Object.values(material.uniforms))
                if (uniform.value instanceof T.Texture)
                    textures.add(uniform.value);
        material.dispose();
    }
    textures.forEach(texture => { texture.dispose(); const image = texture.source?.data; if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
        image.close(); });
    geometries.forEach(geometry => geometry.dispose());
    scene.clear();
}
