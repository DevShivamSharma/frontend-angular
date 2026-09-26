import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export function createGlobeContext(options:{THREE:typeof T;scene:T.Scene;camera:T.PerspectiveCamera;controls:OrbitControls;renderer:T.WebGLRenderer;root:ShadowRoot;signal:AbortSignal;asset:(path:string)=>string;onModeChange:(mode:string)=>void}):Promise<{isGlobe:boolean;transitioning:boolean;goGlobe:()=>void;goVenue:(options:{position:T.Vector3;target:T.Vector3})=>void;update:()=>void;resize?:()=>void}>;
