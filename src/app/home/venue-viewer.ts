import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGlobeContext } from './venue-globe';
import { createVenueRenderLoop } from './venue-render-loop';
import { createVenueWater, prepareVenueFountainJets } from './venue-water';
import { createVenueAmbientOcclusion } from './venue-ambient-occlusion';
import { createVenueSky, VENUE_SUN_DIRECTION, VENUE_MOON_DIRECTION } from './venue-sky';
import { batchVenue } from './venue-batching';
import { prepareItpoArrival } from './venue-itpo-arrival';
import { prepareVenueSurfaceDetail } from './venue-surface-detail';
import { prepareVenueArchitecturalDetail } from './venue-architectural-detail';
import { prepareReferenceHall14 } from './venue-reference-hall14';
import { prepareReferenceMaterials } from './venue-reference-materials';
import { prepareReferenceConcourse, prepareCoveredConcourseFloor } from './venue-reference-concourse';
import { prepareReferenceCanopies } from './venue-reference-canopy';
import { prepareGroundPhotoDetails, preparePhotoEntrances } from './venue-ground-photos';
import { isLegacyContextRoad, revealMappedRoads } from './venue-edge-detail';
import { COLOUR_MATERIALS, createVenueAppearance, INITIAL_APPEARANCE, INITIAL_SCENERY, VenueAppearance, VenueScenery } from './venue-appearance';
import { Triple, Destination, VenueInformation, venueAsset } from './venue.models';
import { createVenueInteriors, InteriorState } from './venue-interiors';
import { createVisitorNavigation } from './visitor-navigation';
import { createVenueVisitor, VisitorInput, VisitorState } from './venue-visitor';
import { createVenueSecurityGuards } from './venue-security-guards';
import { capturePedestrianPaths, createVenuePedestrians } from './venue-pedestrians';
import { prepareVenueSiteDetail, prepareSiteDetailRendering, SiteRegistration, takeMapSurfaces, takeMapSurroundings } from './venue-site-detail';
import { createVenueRouteTrack, ROUTE_FRAME_MS } from './venue-route-track';
import { Point } from './venue-route-geometry';
import { prepareGate9 } from './venue-gate9';
import { createVenueNightLights } from './venue-night-lights';
import { collectVenueLightSources } from './venue-light-sources';
import { createVenueRain } from './venue-rain';
import { prepareVenueRoadFinish } from './venue-road-finish';
import { prepareGate9Paving } from './venue-gate9-paving';
import { delhiTime, isVenueDaylight } from './venue-clock';
import { createVenueMapPins } from './venue-map-pins';
type VenueMesh = T.Mesh<T.BufferGeometry, T.MeshStandardMaterial | T.MeshStandardMaterial[]>;
interface Tween { start:number; duration:number; a:T.Vector3; b:T.Vector3; p:T.Vector3; t:T.Vector3; }
interface ViewerEvents { progress:(fraction:number)=>void; selected:(id:string,level:number)=>void; modeChanged:(mode:'venue'|'globe')=>void; status:(text:string)=>void; geographyReady:(ready:boolean)=>void; satelliteReady?:()=>void; interiorState?:(state:InteriorState)=>void; interiorsReady?:(halls:{id:string;label:string;rooms?:{id:string;label:string}[]}[],error?:string)=>void; visitorState?:(state:VisitorState)=>void; visitorReady?:(destinations:{id:string;label:string}[])=>void; routeEnded?:()=>void; initialAppearanceFailed?:()=>void; }
export interface VenueViewer { ready:Promise<VenueInformation>; view:(id:string)=>void; selectLevel:(level:number)=>void; goGlobe:()=>void; zoom:(factor:number)=>void; setDaylight:(enabled:boolean)=>void; setRain:(enabled:boolean)=>void; setAppearance:(mode:VenueAppearance)=>Promise<void>; setScenery:(scenery:VenueScenery)=>void; setPaused:(paused:boolean)=>void; enterHall:(id:string,guided?:boolean)=>void; pauseTour:()=>void; leaveInterior:()=>void; walk:(forward:number,turn?:number)=>void; exportHall:(id:string)=>Promise<ArrayBuffer>; visitRoom:(id:string,room:string)=>void; startVisitor:()=>void; stopVisitor:()=>void; visitorInput:(input:VisitorInput,down:boolean)=>void; visitorStep:(input:VisitorInput)=>void; visitorDestination:(id:string)=>void; visitorGo:()=>void; visitorEnter:()=>void; visitorJump:()=>void; visitorStopAutoWalk:()=>void; visitorFaster:()=>void; visitorRestart:()=>void; visitorFloor:(level:number)=>void; showRoute:(points:Point[])=>void; clearRoute:()=>void; walkRoute:(points:Point[],label:string,destination?:string)=>void; readonly isGlobe:boolean; dispose:()=>void; }
/** Render camera motion and visible fountain water with consistent scene shading. */
export function createVenueViewer(canvas: HTMLCanvasElement, loadInformation: () => Promise<VenueInformation>, events: ViewerEvents, markerElement?: HTMLElement, pinLayer?: HTMLElement): VenueViewer {
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const cleanups: (() => void)[] = [];
    const asset = venueAsset;
    const listen = <K extends keyof WindowEventMap>(type: K, callback: (event: WindowEventMap[K]) => void) => window.addEventListener(type, callback, { signal });
    let viewCommand = (_id:string) => {}, levelCommand = (_level:number) => {}, globeCommand = () => {}, zoomCommand = (_factor:number) => {}, lightCommand = (_enabled:boolean) => {}, rainCommand = (_enabled:boolean) => {}, isGlobe = () => false;
    let appearanceCommand = async (_mode: VenueAppearance) => {};
    let sceneryCommand = (_scenery: VenueScenery) => {};
    // Image view pauses the render loop instead of disposing, so going back to 3D is instant.
    let paused = false, pauseFrames = () => {}, resumeFrames = () => {};
    let enterCommand=(_id:string,_guided=false)=>{},pauseCommand=()=>{},leaveCommand=()=>{},walkCommand=(_forward:number,_turn=0)=>{};
    let roomCommand=(_id:string,_room:string)=>{};
    let visitor:ReturnType<typeof createVenueVisitor>|undefined;
    let startVisitorCommand=()=>{},stopVisitorCommand=()=>{};
    let showRouteCommand=(_points:Point[])=>{},clearRouteCommand=()=>{},walkRouteCommand=(_points:Point[],_label:string,_destination?:string)=>{};
    let exportCommand=async(_id:string):Promise<ArrayBuffer>=>{throw new Error('Interiors are still loading');};
    const ready = initializeVenue();
    return { ready, view:id=>viewCommand(id), selectLevel:n=>levelCommand(n), goGlobe:()=>globeCommand(), zoom:f=>zoomCommand(f), setDaylight:d=>lightCommand(d), setRain:r=>rainCommand(r), setAppearance:mode=>appearanceCommand(mode), setScenery:s=>sceneryCommand(s), setPaused:p=>{paused=p;if(p)pauseFrames();else resumeFrames();}, enterHall:(id,guided)=>enterCommand(id,guided),pauseTour:()=>pauseCommand(),leaveInterior:()=>leaveCommand(),walk:(f,t)=>walkCommand(f,t),exportHall:id=>exportCommand(id),visitRoom:(id,room)=>roomCommand(id,room),startVisitor:()=>startVisitorCommand(),stopVisitor:()=>stopVisitorCommand(),visitorInput:(i,d)=>visitor?.input(i,d),visitorStep:i=>visitor?.step(i),visitorDestination:id=>visitor?.destination(id),visitorGo:()=>visitor?.goToDestination(),visitorEnter:()=>visitor?.enterNearby(),visitorJump:()=>visitor?.jump(),visitorStopAutoWalk:()=>visitor?.stopAutoWalk(),visitorFaster:()=>visitor?.faster(),visitorRestart:()=>visitor?.restart(),visitorFloor:n=>visitor?.floor(n),showRoute:points=>showRouteCommand(points),clearRoute:()=>clearRouteCommand(),walkRoute:(points,label,destination)=>walkRouteCommand(points,label,destination),get isGlobe(){return isGlobe();}, dispose };
    function dispose() {
        if (signal.aborted) return;
        lifetime.abort();
        // A disposed wrapper can outlive its Angular view. Release the delegates
        // and cleanup closures too: they capture the complete collision/scene graph.
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
        visitor = undefined;
        const noop = () => {};
        viewCommand = levelCommand = globeCommand = zoomCommand = lightCommand = rainCommand = noop;
        sceneryCommand = enterCommand = pauseCommand = leaveCommand = walkCommand = roomCommand = noop;
        startVisitorCommand = stopVisitorCommand = clearRouteCommand = noop;
        showRouteCommand = walkRouteCommand = noop;
        appearanceCommand = async () => {};
        isGlobe = () => false;
        exportCommand = async () => { throw new Error('Viewer has been disposed'); };
    }
    async function initializeVenue() {
        signal.throwIfAborted();
        const scene = new T.Scene();
        cleanups.push(() => disposeScene(scene));
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
        // Near-horizontal tilt and close orbiting are allowed in venue mode too,
        // so a viewer can drop to eye level at any spot without the walk mode.
        controls.maxPolarAngle = Math.PI * .49;
        controls.minDistance = 6;
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
        const sky = createVenueSky(renderer);
        scene.add(sky.mesh);
        cleanups.push(() => { scene.remove(sky.mesh); sky.dispose(); });
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
        let mapSurfaces: T.Group | undefined, scenery: VenueScenery = INITIAL_SCENERY, appearanceMode: VenueAppearance = 'natural';
        let historicalSurroundings: T.Group | undefined, mapSurroundingsReady = false;
        function syncSurroundings() {
            if (!root || !historicalSurroundings) return;
            if (appearanceMode === 'color' && scenery === 'map' && mapSurroundingsReady) historicalSurroundings.removeFromParent();
            else root.add(historicalSurroundings);
        }
        let siteRegistration: SiteRegistration | undefined;
        let gate9: Awaited<ReturnType<typeof prepareGate9>> | undefined;
        let pendingInterior: (()=>void) | undefined;
        let interiors:Awaited<ReturnType<typeof createVenueInteriors>>|undefined,daylight=isVenueDaylight(delhiTime());
        let water: ReturnType<typeof createVenueWater> | undefined;
        // Route mode: the aerial walking route. The orbit settings it replaces are restored on the way out.
        let routeTrack: ReturnType<typeof createVenueRouteTrack> | undefined, routeTimer: number | undefined, routeLockPending = false;
        let routeMode: { fov: number; minPolar: number; maxPolar: number; rotate: boolean; maxDistance: number } | undefined;
        cleanups.push(() => window.clearTimeout(routeTimer));
        let securityGuards: Awaited<ReturnType<typeof createVenueSecurityGuards>> | undefined;
        let nightLights: ReturnType<typeof createVenueNightLights> | undefined;
        let rain: ReturnType<typeof createVenueRain> | undefined, raining = false;
        const rainFog = new T.Fog(0x9ea6ab, 110, 1500);
        let pedestrians: Awaited<ReturnType<typeof createVenuePedestrians>> | undefined;
        let crowdRenderScale = 1;
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        const frames = createVenueRenderLoop(updateFrame, renderFrame);
        const invalidate = () => { ambientOcclusion.invalidate(); if (prepared && !paused) frames.invalidate(); };
        pauseFrames = () => frames.pause(); resumeFrames = invalidate;
        reducedMotion.addEventListener('change', invalidate, { signal });
        cleanups.push(() => frames.dispose());
        const updatePins = pinLayer ? createVenueMapPins(pinLayer, camera, canvas, invalidate, signal) : undefined;
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) frames.pause(); else invalidate();
        }, { signal });
        canvas.addEventListener('webglcontextrestored', () => {
            sky.rebuild();
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
        // The model download starts at once, alongside the information and the globe, instead of after them.
        // The meshopt copy (scripts/compress-venue-models.mjs, lossless) is a third smaller; the export is the fallback.
        const loadModel = (path: string) => new Promise<GLTF>((resolve, reject) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(asset(path), resolve, p => { if (p.total)
            events.progress(p.loaded / p.total * .95); }, reject));
        const modelLoad = loadModel('IITF_2026_ARCHITECTURAL.meshopt.glb?v=outputs-20260927').catch(() => loadModel('IITF_2026_ARCHITECTURAL.glb?v=outputs-20260927'));
        modelLoad.catch(() => {});   // awaited below; this only keeps an early failure from reporting as unhandled
        preloadVenueAssets(asset, signal);
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
            nightLights?.setDaylight(daylight);
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
        const ROUTE_FOV = 18, ROUTE_MAX_DISTANCE = 4200;   // stays under the globe's automatic departure at 4600 m
        const degrees = (fov: number) => Math.tan(T.MathUtils.degToRad(fov / 2));
        /** Change the field of view and keep the framing by moving along the view line. */
        function setFov(fov: number) {
            const distance = camera.position.distanceTo(controls.target) * degrees(camera.fov) / degrees(fov);
            camera.fov = fov; camera.updateProjectionMatrix();
            camera.position.sub(controls.target).setLength(distance).add(controls.target);
        }
        function leaveRoute() {
            if (!routeMode) return;
            const saved = routeMode; routeMode = undefined; routeLockPending = false;
            routeTrack?.clear(); setFov(saved.fov);
            controls.minPolarAngle = saved.minPolar; controls.maxPolarAngle = saved.maxPolar; controls.enableRotate = saved.rotate; controls.maxDistance = saved.maxDistance;
            events.routeEnded?.(); invalidate();
        }
        function view(id:string) {
            leaveRoute();
            pendingInterior=undefined;
            visitor?.stop();
            interiors?.leave();controls.enabled=true;controls.minDistance=6;
            controls.maxPolarAngle = Math.PI * .49;
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
        views['gate9'] = { p: [-574, -349, 18], t: [-540, -365, 2.2], radius: 18 };
        levelCommand=n=>{view('cc');level=n;};
        globeCommand=()=>{leaveRoute();pendingInterior=undefined;visitor?.stop();interiors?.leave();controls.enabled=true;resetLevel();tween=null;globe?.goGlobe();};
        isGlobe=()=>!!globe?.isGlobe;
        zoomCommand=f=>{if(interiors?.active){interiors.step(f<1?1:-1);return;}if(globe?.transitioning)return;tween=null;camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update();invalidate();};
        // Sun/moon and rain share one lighting pass: rain flattens the sun into
        // overcast skylight and adds grey haze, by day or by night.
        const applyLighting=()=>{
            sun.intensity=(daylight?3.8:.22)*(raining?.28:1);
            sun.color.set(daylight?(raining?0xe4e8ec:0xffefda):0xc4d8ff);
            sun.position.copy(daylight?VENUE_SUN_DIRECTION:VENUE_MOON_DIRECTION).multiplyScalar(760);
            hemi.intensity=(daylight?1.3:.48)*(raining?.85:1);
            hemi.color.set(daylight&&raining?0xc9ced2:0xe0eaff);
            fill.intensity=daylight?.25:.3;
            renderer.toneMappingExposure=daylight?(raining?.98:1.05):1.12;
            scene.environmentIntensity=(daylight?.6:.3)*(raining?.7:1);
            rainFog.color.set(daylight?0x9ea6ab:0x1a2029);
            sky.setDaylight(daylight);
            sky.setRain(raining);
            nightLights?.setDaylight(daylight);
            renderer.shadowMap.needsUpdate=true;
            invalidate();
        };
        lightCommand=enabled=>{daylight=enabled;applyLighting();};
        rainCommand=enabled=>{raining=enabled;rain?.setEnabled(enabled);applyLighting();};
        controls.addEventListener('start', () => { tween = null; });
        controls.addEventListener('change', invalidate);
        camera.position.copy(W(...views['overview'].p));
        controls.target.copy(W(...views['overview'].t));
        const initialFit = 510 / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.78, 1 / camera.aspect);
        camera.position.sub(controls.target).setLength(initialFit).add(controls.target);
        controls.update();
        try {
            globe=await createGlobeContext({scene,camera,controls,renderer,signal,asset,markerElement,onModeChange:events.modeChanged,onInvalidate:invalidate,onAtmosphereChange:sky.setSpaceMix,onSatelliteReady:events.satelliteReady,
                onSurroundingsReady: () => { mapSurroundingsReady = true; syncSurroundings(); renderer.shadowMap.needsUpdate = true; invalidate(); },
                onLocalMapReady: () => {
                    localMapReady = true;
                    if (root) revealMappedRoads(root);
                    renderer.shadowMap.needsUpdate = true;
                }});
            sceneryCommand = next => { scenery = next; globe?.setScenery(next); };
            globe.setScenery(scenery);
            events.geographyReady(true);
        } catch(error) { if(!signal.aborted)console.warn('Geographic context unavailable',error);events.geographyReady(false); }
        signal.throwIfAborted();
        const g = await modelLoad;
        if (signal.aborted) {
            disposeScene(g.scene);
            signal.throwIfAborted();
        }
        root = g.scene;
        // Interior assets load before the model is attached. An early route exit
        // must still release these textures and geometry explicitly.
        cleanups.push(() => { if (root && !root.parent) disposeScene(root); });
        prepareVenueSurfaceDetail(root);
        prepareReferenceHall14(root);
        prepareReferenceMaterials(root);
        prepareVenueArchitecturalDetail(root);
        prepareReferenceConcourse(root);
        prepareReferenceCanopies(root);
        prepareCoveredConcourseFloor(root);
        prepareGroundPhotoDetails(root, new T.TextureLoader().load(asset('references/concourse-banner-photo.jpg'), () => invalidate()));
        prepareVenueFountainJets(root);
        try {
            siteRegistration = await prepareVenueSiteDetail(root, asset, signal);
            globe?.setSiteDetail(siteRegistration);
            const surfaces = mapSurfaces = takeMapSurfaces(root);
            cleanups.push(() => { if (!surfaces.parent) disposeScene(surfaces); });
        } catch (error) {
            signal.throwIfAborted();
            console.warn('Venue surroundings could not load; retaining the existing context.', error);
        }
        try {
            gate9 = await prepareGate9(root, asset, signal);
        } catch (error) {
            signal.throwIfAborted();
            console.warn('Gate 9 detail could not load; retaining the existing entrance.', error);
        }
        prepareItpoArrival(root);
        prepareVenueRoadFinish(root);
        prepareGate9Paving(root);
        try {
            interiors=await createVenueInteriors({root,scene,camera,canvas,asset,signal,invalidate,shadowsChanged:()=>renderer.shadowMap.needsUpdate=true,exit:()=>leaveCommand(),daylight:()=>daylight,state:state=>{
                controls.enabled=!state.walking&&!visitor?.active;
                if(!state.walking){controls.target.copy(camera.position).add(new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion).multiplyScalar(32));}
                events.interiorState?.(state);
                renderer.shadowMap.needsUpdate=true;
            }});
            cleanups.push(()=>interiors?.dispose());
            events.interiorsReady?.(interiors.halls.map(h=>({id:h.id,label:h.label,rooms:h.rooms?.map(r=>({id:r.id,label:r.label}))})));
            enterCommand=(id,guided=false)=>{leaveRoute();visitor?.stop();if(globe?.isGlobe||globe?.transitioning){view(id.startsWith('cc-level')?'cc':id);pendingInterior=()=>enterCommand(id,guided);events.status('Returning to the venue…');return;}tween=null;resetLevel();highlight('');interiors?.enter(id,guided);events.status(`${interiors?.hall?.label??'Hall'} · ${guided?'Guided tour':'Interior walkthrough'}`);};
            levelCommand=n=>{
                leaveRoute();visitor?.stop();
                if(globe?.isGlobe||globe?.transitioning){view('cc');pendingInterior=()=>levelCommand(n);return;}
                tween=null;resetLevel();highlight('');const h=interiors?.preview(`cc-level${n}`);if(!h)return;
                level=n;controls.enabled=true;controls.minDistance=8;controls.maxPolarAngle=Math.PI*.48;
                const c=Math.cos(h.angle),s=Math.sin(h.angle),offset=h.depth*.35;
                controls.target.copy(h.center);camera.position.set(h.center.x-offset*s,h.center.y+Math.max(h.width,h.depth)*1.65*Math.max(1,.8/camera.aspect),h.center.z+offset*c);
                camera.near=.2;camera.fov=45;camera.updateProjectionMatrix();controls.update();invalidate();
                events.status(`Convention Centre · Level ${n} · 3D floor plan`);
            };
            roomCommand=(id,room)=>{if(globe?.isGlobe||globe?.transitioning){view('cc');pendingInterior=()=>roomCommand(id,room);return;}enterCommand(id);interiors?.visit(id,room);events.status(`${interiors?.hall?.label} · ${interiors?.hall?.rooms?.find(r=>r.id===room)?.label??'Walkthrough'}`);};
            leaveCommand=()=>{const h=interiors?.hall;if(h?.level)levelCommand(h.level);else{view(h?.id??'overview');events.status('Bharat Mandapam');}};
            pauseCommand=()=>interiors?.pause();walkCommand=(f,t)=>interiors?.step(f,t);
            exportCommand=async id=>{
                const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
                const selected=interiors?.halls.find(h=>h.id===id);if(!selected)throw new Error('Select a furnished hall');
                const model=new T.Group();model.name=`Bharat_Mandapam_${id}`;model.userData={referenceInteriors:interiors!.layer.userData,walkthrough:'Camera navigation, collisions, cutaway and guided routes are runtime viewer features.'};
                root!.updateMatrixWorld(true);interiors!.layer.updateMatrixWorld(true);
                root!.traverse(o=>{if(!selected.level&&o instanceof T.Mesh&&classify(o)===id){const clone=o.clone(false);clone.matrix.copy(o.matrixWorld);clone.matrixAutoUpdate=false;clone.visible=true;model.add(clone);}});
                const furnishing=interiors!.layer.children.find(o=>selected.level?o.userData['ccLevel']===selected.level:o.userData['hall']===id.slice(4));if(furnishing){const clone=furnishing.clone(true);clone.traverse(o=>{o.visible=true;});model.add(clone);}
                return await new GLTFExporter().parseAsync(model,{binary:true,onlyVisible:false}) as ArrayBuffer;
            };
        } catch(error) {signal.throwIfAborted();console.warn('Interior components unavailable',error);events.interiorsReady?.([],'Interiors could not load. Reload to retry.');}
        const visitorNavigation = createVisitorNavigation(root, interiors?.halls ?? [], interiors?.obstacles ?? new Map(), interiors?.layer, gate9?.arrival);
        const onPedestrianPath = capturePedestrianPaths(root);
        preparePhotoEntrances(root, visitorNavigation.portals);
        const venueLightSources = collectVenueLightSources(root, gate9?.lights ?? [], visitorNavigation.portals);
        // Export retains the authored venue metres, Y-up, not geographic east/south.
        // Do not rotate the glTF; W converts only the authored navigation coordinates.
        batchVenue(root, classify, o => [
            ancestorMatches(o, /GROUND|paving|water|lawns|floor plan/i),
            ancestorMatches(o, /^PHOTO_CC|^PHOTO_Swept|^PHOTO_Ramp|^PHOTO_ROOF_SIGN_BOARD_CC|^ROOF_LABEL_CC|^ARCH_CC_SIGN/),
            /label|sign|glass|glazing|light|spray/i.test(o.name),
            isLegacyContextRoad(o),
            !!o.userData['supersededBySiteReference'],
            !!o.userData['mapSurroundingsReplacement']
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
        if (siteRegistration) prepareSiteDetailRendering(root, siteRegistration);
        const appearance = createVenueAppearance(root, renderer, asset, signal);
        cleanups.push(() => appearance.dispose());
        if (siteRegistration) {
            const historical = historicalSurroundings = takeMapSurroundings(root);
            root.add(historical);
            cleanups.push(() => { if (!historical.parent) disposeScene(historical); });
        }
        // After batching and per-mesh material cloning, so the glow edits touch the live materials.
        nightLights = createVenueNightLights(scene, root, venueLightSources);
        cleanups.push(() => nightLights?.dispose());
        rain = createVenueRain(scene, root);
        cleanups.push(() => rain?.dispose());
        if (raining) rain.setEnabled(true);
        water = createVenueWater(root);
        cleanups.push(() => water?.dispose());
        routeTrack = createVenueRouteTrack(scene, invalidate);
        cleanups.push(() => routeTrack?.dispose());
        // Screen up in route mode is east, so Mathura Road runs along the bottom as on the ITPO map;
        // the direction comes from the satellite registration rather than a guessed angle.
        const fit = siteRegistration?.satelliteReference?.fit;
        const east = fit ? new T.Vector2(fit.x[0], fit.z[0]).normalize() : new T.Vector2(0, -1);
        showRouteCommand=points=>{
            if(globe?.isGlobe||globe?.transitioning){view('overview');pendingInterior=()=>showRouteCommand(points);return;}
            if(!routeTrack||points.length<2)return;
            pendingInterior=undefined;visitor?.stop();interiors?.leave();resetLevel();highlight('');controls.enabled=true;
            if(!routeMode){
                routeMode={fov:camera.fov,minPolar:controls.minPolarAngle,maxPolar:controls.maxPolarAngle,rotate:controls.enableRotate,maxDistance:controls.maxDistance};
                setFov(ROUTE_FOV);
            }
            controls.minPolarAngle=0;controls.enableRotate=true;controls.maxDistance=ROUTE_MAX_DISTANCE;
            routeTrack.show(points);
            // Fit the route on screen, measured along the screen's up (east) and right axes.
            const right=new T.Vector2(-east.y,east.x);let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
            for(const p of points){const u=p.x*east.x+p.z*east.y,v=p.x*right.x+p.z*right.y;u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);}
            const um=(u0+u1)/2,vm=(v0+v1)/2,half=Math.max((u1-u0)/2*1.2+25,((v1-v0)/2*1.2+25)/camera.aspect);
            const height=T.MathUtils.clamp(half/degrees(ROUTE_FOV),150,ROUTE_MAX_DISTANCE);
            const target=new T.Vector3(east.x*um+right.x*vm,0,east.y*um+right.y*vm);
            // A tiny southward offset gives OrbitControls a heading, so screen up is east.
            const eye=target.clone().add(new T.Vector3(-east.x*height*.002,height,-east.y*height*.002));
            routeLockPending=true;fly(eye,target,1600);
        };
        clearRouteCommand=()=>{if(routeMode){leaveRoute();view('overview');}};
        try {
            securityGuards = await createVenueSecurityGuards({ renderer, navigation: visitorNavigation, asset, signal, extra: gate9?.guards });
            scene.add(securityGuards.group);
            cleanups.push(() => securityGuards?.dispose());
        } catch (error) {
            signal.throwIfAborted();
            // A failed optional asset must never leave invisible collision bodies.
            console.warn('Entrance security could not load. Reload to retry.', error);
        }
        visitor = createVenueVisitor({root,scene,camera,canvas,navigation:visitorNavigation,
            interiorLayer:interiors?.layer,
            halls:interiors?.halls??[],obstacles:interiors?.obstacles??new Map(),signal,invalidate,
            reducedMotion:()=>reducedMotion.matches,showInterior:id=>interiors?.setVisitorHall(id),
            changed:state=>{gate9?.visitorChanged(state);events.visitorState?.(state);if(state.active)events.status(`Visiting · ${state.location}`);},
            exit:()=>stopVisitorCommand()});
        cleanups.push(()=>visitor?.dispose());
        // Optional crowd loads after the venue/navigation are ready, sharing one
        // asset across all walkers without delaying the welcome screen.
        void createVenuePedestrians({ navigation: visitorNavigation, onPath: onPedestrianPath, asset, signal }).then(crowd => {
            if (signal.aborted) { crowd.dispose(); return; }
            pedestrians = crowd; scene.add(crowd.group);
            cleanups.push(() => crowd.dispose()); invalidate();
        }).catch(error => { if (!signal.aborted) console.warn('Concourse pedestrians unavailable.', error); });
        events.visitorReady?.(visitorNavigation.portals.map(p=>({id:p.hall.id,label:p.hall.level?'Convention Centre':p.hall.label})));
        startVisitorCommand=()=>{
            if(globe?.isGlobe||globe?.transitioning){view('overview');pendingInterior=()=>startVisitorCommand();events.status('Returning to the venue…');return;}
            leaveRoute();pendingInterior=undefined;tween=null;interiors?.leave();resetLevel();highlight('');
            controls.enabled=false;visitor?.start();renderer.shadowMap.needsUpdate=true;invalidate();
        };
        stopVisitorCommand=()=>{pendingInterior=undefined;visitor?.stop();view('overview');events.status('Bharat Mandapam');};
        // A Directions route walked by the visitor: route mode gives way to the visitor's own camera.
        walkRouteCommand=(points,label,destination)=>{
            if(globe?.isGlobe||globe?.transitioning){view('overview');pendingInterior=()=>walkRouteCommand(points,label,destination);events.status('Returning to the venue…');return;}
            if(!visitor?.active)startVisitorCommand();
            visitor?.followRoute(points,label,destination);
        };
        // Selection must restore the finished baseline, including before the first palette switch.
        for (const mesh of pickMeshes) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            originals.set(mesh, mats.map(m => ({color:m.color.clone(), emissive:m.emissive.clone(), emissiveIntensity:m.emissiveIntensity})));
        }
        appearanceCommand = async mode => {
            nightLights?.setDaylight(true);
            await appearance.apply(mode, scenery);
            appearanceMode = mode;
            syncSurroundings();
            // Venue ground surfaces belong to Color → Map only; attach/detach, never toggle visible.
            if (mapSurfaces && root) { if (mode === 'color' && scenery === 'map') root.add(mapSurfaces); else mapSurfaces.removeFromParent(); }
            nightLights?.refreshMaterials();
            nightLights?.setDaylight(daylight);
            rain?.refreshMaterials();
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
        // In Color, a scenery switch also swaps the surroundings' Map finishes and the venue ground surfaces.
        sceneryCommand = next => {
            scenery = next; globe?.setScenery(next);
            if (appearanceMode === 'color') void appearanceCommand('color').catch(error => console.warn('Map finishes unavailable', error));
        };
        // Open on the initial appearance before the welcome screen lifts. Without the palette the venue stays Natural.
        if (INITIAL_APPEARANCE !== 'natural') await appearanceCommand(INITIAL_APPEARANCE).catch(error => {
            signal.throwIfAborted(); console.warn('Color materials unavailable; opening in Natural.', error); events.initialAppearanceFailed?.();
        });
        events.status('Bharat Mandapam');
        lightCommand(isVenueDaylight(delhiTime()));
        const detailView = new URLSearchParams(location.search).get('view');
        const fitDetailWidth = (aspect: number) =>
            ['itpo-arrival', 'itpo-office', 'gate9', 'gate9-checking-room', 'gate6-road', 'fountain', 'cc-cascade', 'hall6-basin'].includes(detailView ?? '') ? Math.max(1, 1.4 / aspect) : 1;
        const waterViews: Record<string, { position: Triple; target: Triple; label: string }> = {
            ...gate9?.views,
            'itpo-arrival': { position: W(-322, -302, 68).toArray() as Triple, target: W(-431, -357, 5).toArray() as Triple, label: 'ITPO · Arrival court' },
            'itpo-parking': { position: W(-401, -344, 2.2).toArray() as Triple, target: W(-335, -332, 4).toArray() as Triple, label: 'ITPO · Covered parking approach' },
            'itpo-side': { position: W(-411, -297, 2.2).toArray() as Triple, target: W(-360, -290, 11).toArray() as Triple, label: 'ITPO · Curved frontage' },
            'itpo-back': { position: W(-433, -392, 2.2).toArray() as Triple, target: W(-435, -408, 2).toArray() as Triple, label: 'ITPO · Service garden' },
            'hall14-front': { position: [-67.7, 40, 94.9], target: [-223.6, 12, 4.9], label: 'Hall 14 · Frontage' },
            'concourse': { position: [52.423, 1.9, 149.201], target: [95.724, 1.7, 174.201], label: 'Covered Concourse' },
            'hall-spine': { position: [115.786, 1.9, 153.452], target: [143.286, 1.7, 105.821], label: 'Hall 1–6 · Covered Walk' },
            'fountain': { position: [160, 78, 345], target: [67, 2, 250], label: 'Musical Fountain' },
            'cc-cascade': { position: [-125, 67, 265], target: [-207, 3, 205], label: 'Convention Centre · Cascades' },
            'hall6-basin': { position: [286, 6, -158], target: [265, .7, -182], label: 'Hall 6 · Water Garden' }
        };
        if (detailView && waterViews[detailView]) {
            const waterView = waterViews[detailView];
            if (detailView === 'concourse' || detailView === 'hall-spine' || detailView.startsWith('gate9-') || detailView.startsWith('itpo-')) controls.maxPolarAngle = Math.PI * .4998;
            if (detailView.startsWith('gate9-') || detailView.startsWith('itpo-')) { controls.minDistance = 2; camera.near = .12; camera.updateProjectionMatrix(); }
            camera.position.set(...waterView.position);
            controls.target.set(...waterView.target);
            controls.update();
            events.status(waterView.label);
        } else if (detailView === 'gate6-road') {
            camera.position.set(-235, 265, 720);
            controls.target.set(-15, 2, 355);
            controls.update();
            events.status('Gate 6 · Road and entrance');
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
            camera.position.copy(W(-574, -349, 18));
            controls.target.copy(W(-540, -365, 2.2));
            controls.update();
            events.status('Gate 9 · Entrance');
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
        const ccLevel=Number(new URLSearchParams(location.search).get('ccLevel'));
        if([1,2,3].includes(ccLevel))levelCommand(ccLevel);
        const entry=new URLSearchParams(location.search).get('interior');
        if(entry&&interiors?.halls.some(h=>h.id===entry)){enterCommand(entry);if(new URLSearchParams(location.search).get('interiors')==='off')interiors.layer.visible=false;}
        const ray = new T.Raycaster(), pointer = new T.Vector2();
        let down: [
            number,
            number
        ] | undefined;
        renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, { signal });
        renderer.domElement.addEventListener('pointercancel', () => { down = undefined; }, { signal });
        renderer.domElement.addEventListener('pointerup', e => {
            const start = down; down = undefined;
            if (!root || !start || visitor?.active || interiors?.active || globe?.isGlobe || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
            const rect = canvas.getBoundingClientRect();
            pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
            ray.setFromCamera(pointer, camera);
            const visibleMeshes = pickMeshes.filter(mesh => {
                if (mesh.userData['mapSurroundingsReplacement'] && !historicalSurroundings?.parent) return false;
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
            renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * crowdRenderScale); renderer.setSize(innerWidth, innerHeight);
            const aspect = innerWidth / innerHeight;
            if (!visitor?.active && !globe?.isGlobe && !globe?.transitioning)
                camera.position.sub(controls.target).multiplyScalar(fitDetailWidth(aspect) / fitDetailWidth(camera.aspect)).add(controls.target);
            camera.aspect = aspect; camera.updateProjectionMatrix(); ambientOcclusion.resize(); invalidate();
        }
        listen('resize', resize);
        listen('pageshow', resize);
        function updateFrame() {
            if(pendingInterior&&!globe?.isGlobe&&!globe?.transitioning){const action=pendingInterior;pendingInterior=undefined;action();}
            if (tween) {
            let k = Math.min(1, (performance.now() - tween.start) / tween.duration);
            k = k * k * (3 - 2 * k);
            camera.position.lerpVectors(tween.a, tween.p, k);
            controls.target.lerpVectors(tween.b, tween.t, k);
            if (k >= 1)
                tween = null;
        }
            // Once the camera has arrived straight above the route, tilt and rotation are locked; pan and zoom stay.
            if (routeLockPending && !tween) {
                routeLockPending = false; controls.update();
                controls.minPolarAngle = controls.maxPolarAngle = controls.getPolarAngle(); controls.enableRotate = false;
            }
            const visiting = visitor?.update(performance.now());
            const gateMoving = gate9?.update(performance.now(), reducedMotion.matches, globe?.isGlobe ? undefined : camera.position);
            if (gateMoving) renderer.shadowMap.needsUpdate = true;
            // Haze only over the venue: flights to the globe keep a clear far plane.
            const hazy = raining && !globe?.isGlobe && !globe?.transitioning && !interiors?.active;
            if ((scene.fog === rainFog) !== hazy) scene.fog = hazy ? rainFog : null;
            const pouring = !globe?.isGlobe && !globe?.transitioning && rain?.update(performance.now(), camera);
            const relit = !globe?.isGlobe && nightLights?.update(camera.position);
            const changed = !visitor?.active && !interiors?.active && !globe?.transitioning && controls.update();
            if(!visitor?.active&&!interiors?.active)globe?.update();
            const walking=interiors?.update(performance.now());
            const flowing = water?.update(performance.now(), camera,
                !reducedMotion.matches && !globe?.isGlobe && camera.position.distanceTo(controls.target) < 3000, innerHeight);
            const strolling = pedestrians?.update(performance.now(), camera, innerHeight,
                !globe?.isGlobe && !globe?.transitioning && !interiors?.active, reducedMotion.matches,
                visitor?.active ? visitor.position : undefined);
            const scale = pedestrians?.group.visible ? pedestrians.group.userData['renderScale'] ?? 1 : 1;
            if (scale !== crowdRenderScale) {
                crowdRenderScale = scale;
                renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * scale);
                ambientOcclusion.resize(); invalidate();
            }
            const routing = !globe?.isGlobe && routeTrack?.update(performance.now(), camera, innerHeight, reducedMotion.matches);
            const moving = Boolean(changed || walking || visiting || gateMoving || strolling || tween || pendingInterior || globe?.transitioning || flowing || pouring || relit);
            // The route alone animates at the app's capped ~40 fps instead of every display frame.
            if (routing && !moving && routeTimer === undefined) routeTimer = window.setTimeout(() => { routeTimer = undefined; invalidate(); }, ROUTE_FRAME_MS);
            return moving;
        }
        function renderFrame() {
            if (securityGuards?.update(camera, innerHeight, !globe?.isGlobe || globe.transitioning))
                renderer.shadowMap.needsUpdate = true;
            // Use the same antialiased materials, lighting and cached shadows for every frame.
            // AO uses the same distance fade during movement and at rest.
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
            updatePins?.(!globe?.isGlobe && !globe?.transitioning && !visitor?.active && !interiors?.active);
            if (!visitor?.active && !interiors?.active) {
                // Screen-space sky has no surface depth or ambient occlusion.
                sky.mesh.visible = false;
                const crowdVisible = pedestrians?.group.visible;
                // Crowd has its own animated GPU poses; exclude it from the
                // cached static AO mask to avoid frozen standing silhouettes.
                if (pedestrians) pedestrians.group.visible = false;
                // The route draws without depth over everything; it has no place in the AO mask.
                if (routeTrack) routeTrack.group.visible = false;
                try { ambientOcclusion.render(camera.position.distanceTo(controls.target)); }
                finally { sky.mesh.visible = true; if (pedestrians) pedestrians.group.visible = !!crowdVisible; if (routeTrack) routeTrack.group.visible = routeTrack.active; }
            }
        }
        // Draw a prepared scene before releasing the welcome screen.
        signal.throwIfAborted();
        if(!interiors?.active){controls.update();globe?.update();}
        interiors?.update(performance.now());
        prepared = true;
        if (!document.hidden) renderFrame();
        invalidate();
        return information;
    }
}
/**
 * The load awaits these one after another (site detail, Gate 9, interiors, guards, then the Color palette and map);
 * preloading fetches them all from the start, and each loader's own fetch() takes the preloaded response (same
 * URL, same-origin CORS mode). The links go when the viewer does.
 */
function preloadVenueAssets(asset: (path: string) => string, signal: AbortSignal): void {
    const paths = ['venue-site-detail.glb', 'venue-site-detail.json', 'gate9-detail.glb', 'gate9-detail.json', 'characters/security-guard.glb',
        ...(INITIAL_APPEARANCE === 'color' ? [COLOUR_MATERIALS] : []), ...(INITIAL_SCENERY === 'map' ? ['geography/venue-map-context.json'] : [])];
    const links = paths.map(path => Object.assign(document.createElement('link'), { rel: 'preload', as: 'fetch', crossOrigin: 'anonymous', href: asset(path) }));
    document.head.append(...links);
    signal.addEventListener('abort', () => links.forEach(link => link.remove()), { once: true });
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
