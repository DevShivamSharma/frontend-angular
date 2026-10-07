import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGlobeContext } from './venue-globe';
import { createVenueRenderLoop } from './venue-render-loop';
import { createVenueWater, prepareVenueFountainJets } from './venue-water';
import { createVenueAmbientOcclusion } from './venue-ambient-occlusion';
import { batchVenue } from './venue-batching';
import { prepareVenueSurfaceDetail } from './venue-surface-detail';
import { prepareVenueArchitecturalDetail } from './venue-architectural-detail';
import { isLegacyContextRoad, revealMappedRoads } from './venue-edge-detail';
import { createVenueAppearance, VenueAppearance, VenueScenery } from './venue-appearance';
import { Triple, Destination, VenueInformation, venueAsset } from './venue.models';
type VenueMesh = T.Mesh<T.BufferGeometry, T.MeshStandardMaterial | T.MeshStandardMaterial[]>;
interface Tween { start:number; duration:number; a:T.Vector3; b:T.Vector3; p:T.Vector3; t:T.Vector3; }
interface ViewerEvents { progress:(fraction:number)=>void; selected:(id:string,level:number)=>void; modeChanged:(mode:'venue'|'globe')=>void; status:(text:string)=>void; geographyReady:(ready:boolean)=>void; satelliteReady?:()=>void; }
export interface VenueViewer { ready:Promise<VenueInformation>; view:(id:string)=>void; selectLevel:(level:number)=>void; goGlobe:()=>void; zoom:(factor:number)=>void; setDaylight:(enabled:boolean)=>void; setAppearance:(mode:VenueAppearance)=>Promise<void>; setScenery:(scenery:VenueScenery)=>void; readonly isGlobe:boolean; dispose:()=>void; }
/** Render camera motion and visible fountain water with consistent scene shading. */
export function createVenueViewer(canvas: HTMLCanvasElement, loadInformation: () => Promise<VenueInformation>, events: ViewerEvents, markerElement?: HTMLElement): VenueViewer {
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const cleanups: (() => void)[] = [];
    const asset = venueAsset;
    const listen = <K extends keyof WindowEventMap>(type: K, callback: (event: WindowEventMap[K]) => void) => window.addEventListener(type, callback, { signal });
    let viewCommand = (_id:string) => {}, levelCommand = (_level:number) => {}, globeCommand = () => {}, zoomCommand = (_factor:number) => {}, lightCommand = (_enabled:boolean) => {}, isGlobe = () => false;
    let appearanceCommand = async (_mode: VenueAppearance) => {};
    let sceneryCommand = (_scenery: VenueScenery) => {};
    const ready = initializeVenue();
    return { ready, view:id=>viewCommand(id), selectLevel:n=>levelCommand(n), goGlobe:()=>globeCommand(), zoom:f=>zoomCommand(f), setDaylight:d=>lightCommand(d), setAppearance:mode=>appearanceCommand(mode), setScenery:s=>sceneryCommand(s), get isGlobe(){return isGlobe();}, dispose:()=>{lifetime.abort();for(const cleanup of cleanups.reverse())cleanup();} };
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
        // Buildings and the sun do not move. Camera movement never needs a new shadow map.
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = true;
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
        const ambientOcclusion = createVenueAmbientOcclusion(renderer, scene, camera);
        cleanups.push(() => ambientOcclusion.dispose());
        const W = (s: number, t: number, z: number) => new T.Vector3(.5 * s + .8660254038 * t, z, -.8660254038 * s + .5 * t);
        const views: Record<string, {
            p: Triple;
            t: Triple;
            radius?: number;
        }> = { overview: { p: [-720, 600, 640], t: [-65, 12, 0] }, cc: { p: [-350, -20, 112], t: [-284, -228, 23] }, fountain: { p: [-295, 276, 95], t: [-201, 182, 0] } };
        let root: T.Group | undefined, tween: Tween | null = null, level = 0, globe: Awaited<ReturnType<typeof createGlobeContext>> | undefined;
        let prepared = false, localMapReady = false;
        let water: ReturnType<typeof createVenueWater> | undefined;
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        const frames = createVenueRenderLoop(updateFrame, renderFrame);
        const invalidate = () => { if (prepared) frames.invalidate(); };
        reducedMotion.addEventListener('change', invalidate, { signal });
        cleanups.push(() => frames.dispose());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) frames.pause(); else invalidate();
        }, { signal });
        canvas.addEventListener('webglcontextrestored', () => {
            renderer.shadowMap.needsUpdate = true;
            invalidate();
        }, { signal });
        const pickMeshes: VenueMesh[] = [], levelObjects: T.Object3D[] = [];
        const meshDestinations = new Map<T.Object3D, string | null>();
        const destinationMeshes = new Map<string, VenueMesh[]>();
        const highlightColor = new T.Color('#ac7855');
        let highlighted: string | undefined;
        const ccMaterials: T.MeshStandardMaterial[] = [], originals = new Map<T.Object3D, {
            color: T.Color;
            emissive: T.Color;
            emissiveIntensity: number;
        }[]>();
        const information = await loadInformation();
        signal.throwIfAborted();
        const { destinations } = information;
        const hallIds = new Set(destinations.filter(d => d.hall).map(d => String(d.hall)));
        const gateIds = new Set(destinations.filter(d => d.gate).map(d => d.id));
        function ancestorMatches(o: T.Object3D, re: RegExp) { for (let n: T.Object3D | null = o; n; n = n.parent)
            if (re.test(n.name))
                return true; return false; }
        function classify(o: T.Object3D) { for (let n: T.Object3D | null = o; n; n = n.parent) {
            if (n.userData['destinationId']) return n.userData['destinationId'] as string;
            if (gateIds.has(n.userData['gate_id'])) return n.userData['gate_id'] as string;
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
        function highlight(id: string) {
            if (id === highlighted) return;
            for (const mesh of destinationMeshes.get(highlighted ?? '') ?? []) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                const base = originals.get(mesh)!;
                mats.forEach((m, i) => {
                    m.color.copy(base[i].color);
                    m.emissive?.copy(base[i].emissive);
                    m.emissiveIntensity = base[i].emissiveIntensity;
                });
            }
            for (const mesh of destinationMeshes.get(id) ?? []) {
                if (/label|sign|glass|glazing|light|spray/i.test(mesh.name) || id === 'fountain') continue;
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const m of mats) {
                    if (!['glazing', 'water', 'water_spray', 'roof_label', 'conceptual_edge_light', 'supplied_floor_plan'].includes(m.userData['architecturalCategory']))
                        m.color.lerp(highlightColor, .25);
                }
            }
            highlighted = id;
        }
        function resetLevel() {
            level = 0;
            for (const object of levelObjects) {
                if (object.visible) { object.visible = false; renderer.shadowMap.needsUpdate = true; }
            }
            for (const material of ccMaterials) {
                if (material.clippingPlanes?.length) {
                    material.clippingPlanes = [];
                    material.needsUpdate = true;
                    renderer.shadowMap.needsUpdate = true;
                }
            }
        }
        function fly(position: T.Vector3, target: T.Vector3, duration = 1350) { if (globe?.isGlobe || globe?.transitioning) {
            tween = null;
            globe.goVenue({ position, target });
            return;
        } tween = { start: performance.now(), duration, a: camera.position.clone(), b: controls.target.clone(), p: position, t: target }; invalidate(); }
        function view(id:string) {
            controls.maxPolarAngle = Math.PI * .46;
            resetLevel();highlight(id);const v=views[id];if(!v)return;
            const target=W(...v.t),eye=W(...v.p);
            const radius=v.radius ?? (({overview:490,cc:110,hall1:70,hall14:70,hall6:86,hall11:74,hall12A:74,hall12:56,fountain:72} as Record<string,number>)[id]||62);
            const fit=radius/Math.tan(T.MathUtils.degToRad(camera.fov/2))*Math.max(.78,1/camera.aspect);
            if(eye.distanceTo(target)<fit)eye.sub(target).setLength(fit).add(target);
            fly(eye,target);
        }
        for(const d of destinations.filter(d=>d.hall).sort((a,b)=>parseInt(a.hall!)-parseInt(b.hall!)||a.hall!.localeCompare(b.hall!))){
            const [s,t,z]=d.center;views[d.id]={p:[s-105,t-120,z+105],t:[s,t,z*.45]};
            if(d.hall==='14')views[d.id].p=[s-95,t+125,z+95];
        }
        viewCommand=view;
        for (const d of destinations.filter(d => d.gate && d.camera))
            views[d.id] = { p: d.camera!, t: d.target ?? d.center, radius: d.radius };
        // Include the adjoining checkpoint when selecting Gate 9 from the menu.
        views['gate9'] = { p: [-571, -401, 22], t: [-536, -369, 2.5], radius: 22 };
        levelCommand=n=>{view('cc');level=n;};
        globeCommand=()=>{resetLevel();tween=null;globe?.goGlobe();};
        isGlobe=()=>!!globe?.isGlobe;
        zoomCommand=f=>{if(globe?.transitioning)return;tween=null;camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update();invalidate();};
        lightCommand=daylight=>{sun.intensity=daylight?3.8:4.5;hemi.intensity=daylight?1.3:.38;renderer.toneMappingExposure=daylight?1.05:.86;scene.environmentIntensity=daylight?.6:.32;invalidate();};
        controls.addEventListener('start', () => { tween = null; });
        controls.addEventListener('change', invalidate);
        camera.position.copy(W(...views['overview'].p));
        controls.target.copy(W(...views['overview'].t));
        const initialFit = 510 / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.78, 1 / camera.aspect);
        camera.position.sub(controls.target).setLength(initialFit).add(controls.target);
        controls.update();
        try {
            globe=await createGlobeContext({scene,camera,controls,renderer,signal,asset,markerElement,onModeChange:events.modeChanged,onInvalidate:invalidate,onSatelliteReady:events.satelliteReady,
                onLocalMapReady: () => {
                    localMapReady = true;
                    if (root) revealMappedRoads(root);
                    renderer.shadowMap.needsUpdate = true;
                }});
            sceneryCommand = scenery => globe?.setScenery(scenery);
            events.geographyReady(true);
        } catch(error) { if(!signal.aborted)console.warn('Geographic context unavailable',error);events.geographyReady(false); }
        signal.throwIfAborted();
        const g = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().load(asset('IITF_2026_ARCHITECTURAL.glb?v=outputs-20260927'), resolve, p => { if (p.total)
            events.progress(p.loaded / p.total * .95); }, reject));
        if (signal.aborted) {
            disposeScene(g.scene);
            signal.throwIfAborted();
        }
        root = g.scene;
        prepareVenueSurfaceDetail(root);
        prepareVenueArchitecturalDetail(root);
        prepareVenueFountainJets(root);
        // Export is already metres, Y-up, east +X / south +Z. Do not rotate the
        // glTF a second time; W converts only the authored navigation coordinates.
        batchVenue(root, classify, o => [
            ancestorMatches(o, /GROUND|paving|water|lawns|floor plan/i),
            ancestorMatches(o, /^PHOTO_CC|^PHOTO_Swept|^PHOTO_Ramp|^PHOTO_ROOF_SIGN_BOARD_CC|^ROOF_LABEL_CC|^ARCH_CC_SIGN/),
            /label|sign|glass|glazing|light|spray/i.test(o.name),
            isLegacyContextRoad(o)
        ].join(':'));
        if (localMapReady) revealMappedRoads(root);
        scene.add(root);
        const replacedMaterials = new Set<T.Material>();
        root.traverse(o => {
            // The two rectangular placeholder slabs otherwise hide the local map.
            // SITE_GROUND and the authored campus roads remain intact.
            if (globe && (o.name === 'OUTER_GROUND' || o.name === 'CONTEXT_GROUND')) o.visible = false;
            if (o.userData['cc_level']) { levelObjects.push(o); o.visible = false; }
            if (!(o instanceof T.Mesh)) return;
            pickMeshes.push(o as VenueMesh);
            // Mesh.raycast can reject a tight box before walking this mesh's triangles.
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const destination = classify(o);
            meshDestinations.set(o, destination);
            if (destination) {
                const meshes = destinationMeshes.get(destination) ?? [];
                meshes.push(o as VenueMesh);
                destinationMeshes.set(destination, meshes);
            }
            const sourceMaterials = Array.isArray(o.material) ? o.material : [o.material]; o.material = Array.isArray(o.material) ? o.material.map((m: T.Material) => m.clone()) : o.material.clone(); sourceMaterials.forEach((m: T.Material) => replacedMaterials.add(m)); const mats = Array.isArray(o.material) ? o.material : [o.material]; if (ancestorMatches(o, /^PHOTO_CC|^PHOTO_Swept|^PHOTO_Ramp|^PHOTO_ROOF_SIGN_BOARD_CC|^ROOF_LABEL_CC|^ARCH_CC_SIGN/))
            ccMaterials.push(...mats); o.castShadow = !ancestorMatches(o, /GROUND|paving|water|lawns|floor plan/i) && !mats.every((m: T.MeshStandardMaterial) => ['paved_ground', 'context_ground', 'water', 'road', 'road_marking', 'supplied_floor_plan'].includes(m.userData['architecturalCategory'])); o.receiveShadow = true; mats.forEach((m: T.MeshStandardMaterial) => { if (m.map)
            m.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); }); originals.set(o, mats.map((m: T.MeshStandardMaterial) => ({ color: m.color.clone(), emissive: m.emissive?.clone() || new T.Color(0), emissiveIntensity: m.emissiveIntensity }))); if (o.userData['cc_level'])
            o.visible = false; });
        replacedMaterials.forEach(material => material.dispose());
        const appearance = createVenueAppearance(root, renderer, asset, signal);
        cleanups.push(() => appearance.dispose());
        water = createVenueWater(root);
        cleanups.push(() => water?.dispose());
        // Selection must restore the finished baseline, including before the first palette switch.
        for (const mesh of pickMeshes) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            originals.set(mesh, mats.map(m => ({color:m.color.clone(), emissive:m.emissive.clone(), emissiveIntensity:m.emissiveIntensity})));
        }
        appearanceCommand = async mode => {
            await appearance.apply(mode);
            water?.refreshMaterials();
            globe?.setAppearance(mode);
            // Refresh selection baselines once per explicit switch, never per frame.
            for (const mesh of pickMeshes) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                originals.set(mesh, mats.map(m => ({color:m.color.clone(), emissive:m.emissive.clone(), emissiveIntensity:m.emissiveIntensity})));
            }
            const selected = highlighted; highlighted = undefined;
            if (selected) highlight(selected);
            renderer.shadowMap.needsUpdate = true;
            invalidate();
        };
        events.status('Bharat Mandapam');
        const detailView = new URLSearchParams(location.search).get('view');
        const fitDetailWidth = (aspect: number) =>
            ['itpo-office', 'gate9', 'fountain', 'cc-cascade', 'hall6-basin'].includes(detailView ?? '') ? Math.max(1, 1.4 / aspect) : 1;
        const waterViews: Record<string, { position: Triple; target: Triple; label: string }> = {
            'fountain': { position: [160, 78, 345], target: [67, 2, 250], label: 'Musical Fountain' },
            'cc-cascade': { position: [-125, 67, 265], target: [-207, 3, 205], label: 'Convention Centre · Cascades' },
            'hall6-basin': { position: [286, 6, -158], target: [265, .7, -182], label: 'Hall 6 · Water Garden' }
        };
        if (detailView && waterViews[detailView]) {
            const waterView = waterViews[detailView];
            camera.position.set(...waterView.position);
            controls.target.set(...waterView.target);
            controls.update();
            events.status(waterView.label);
        } else if (new URLSearchParams(location.search).get('view') === 'cc-forecourt') {
            camera.position.copy(W(10.685, 141.551, 220));
            controls.target.copy(W(-284.315, -123.449, 5));
            controls.update();
            events.status('Convention Centre · Forecourt');
        } else if (new URLSearchParams(location.search).get('view') === 'itpo-office') {
            camera.position.copy(W(-565, -480, 115));
            controls.target.copy(W(-450, -379, 5));
            controls.update();
            events.status('ITPO Office');
        } else if (new URLSearchParams(location.search).get('view') === 'itpo-courtyard') {
            controls.maxPolarAngle = Math.PI * .4998;
            camera.position.copy(W(-407, -384, 2.2));
            controls.target.copy(W(-487, -386, 2));
            controls.update();
            events.status('ITPO Office · Garden Walk');
        } else if (new URLSearchParams(location.search).get('view') === 'gate9') {
            camera.position.copy(W(-571, -401, 22));
            controls.target.copy(W(-536, -369, 2.5));
            controls.update();
            events.status('Gate 9 · Security Check');
        } else if (new URLSearchParams(location.search).get('view') === 'itpo-walkway') {
            // Eye level on the office's east walk, looking along it as in the site photo.
            controls.maxPolarAngle = Math.PI * .4998;
            camera.position.copy(W(-486, -350, 2.2));
            controls.target.copy(W(-405, -345, 1.6));
            controls.update();
            events.status('ITPO Office · Walkway');
        }
        camera.position.sub(controls.target).multiplyScalar(fitDetailWidth(camera.aspect)).add(controls.target);
        controls.update();
        const ray = new T.Raycaster(), pointer = new T.Vector2();
        let down: [
            number,
            number
        ] | undefined;
        renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, { signal });
        renderer.domElement.addEventListener('pointercancel', () => { down = undefined; }, { signal });
        renderer.domElement.addEventListener('pointerup', e => {
            const start = down; down = undefined;
            if (!root || !start || globe?.isGlobe || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
            const rect = canvas.getBoundingClientRect();
            pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
            ray.setFromCamera(pointer, camera);
            const visibleMeshes = pickMeshes.filter(mesh => {
                for (let node: T.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false;
                return true;
            });
            for (const hit of ray.intersectObjects(visibleMeshes, false)) {
            const material = (hit.object as VenueMesh).material;
            const mat = Array.isArray(material) ? material[hit.face!.materialIndex] : material;
            if (mat.clippingPlanes?.some((p: T.Plane) => p.distanceToPoint(hit.point) < 0))
                continue;
            const id = meshDestinations.get(hit.object);
            if (id) { events.selected(id, level); break; }
            if (!mat.transparent || mat.opacity > .9)
                break;
        } }, { signal });
        function resize() {
            renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
            const aspect = innerWidth / innerHeight;
            if (!globe?.isGlobe && !globe?.transitioning)
                camera.position.sub(controls.target).multiplyScalar(fitDetailWidth(aspect) / fitDetailWidth(camera.aspect)).add(controls.target);
            camera.aspect = aspect; camera.updateProjectionMatrix(); ambientOcclusion.resize(); invalidate();
        }
        listen('resize', resize);
        listen('pageshow', resize);
        function updateFrame() { if (tween) {
            let k = Math.min(1, (performance.now() - tween.start) / tween.duration);
            k = k * k * (3 - 2 * k);
            camera.position.lerpVectors(tween.a, tween.p, k);
            controls.target.lerpVectors(tween.b, tween.t, k);
            if (k >= 1)
                tween = null;
        }
            const changed = !globe?.transitioning && controls.update();
            globe?.update();
            const flowing = water?.update(performance.now(), camera,
                !reducedMotion.matches && !globe?.isGlobe && camera.position.distanceTo(controls.target) < 3000);
            return Boolean(changed || tween || globe?.transitioning || flowing);
        }
        function renderFrame() {
            // Use the same antialiased materials, lighting and cached shadows for every frame.
            // The AO mask is always applied, so stopping input never changes the finish.
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
            ambientOcclusion.render(camera.position.distanceTo(controls.target));
        }
        // Draw a prepared scene before releasing the welcome screen.
        signal.throwIfAborted();
        controls.update();
        globe?.update();
        prepared = true;
        if (!document.hidden) renderFrame();
        invalidate();
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
