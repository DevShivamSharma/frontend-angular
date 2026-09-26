export interface LoadingGate { run(id:string,task:()=>Promise<unknown>):Promise<unknown>; progress(id:string,value:number):void; }
export function createLoadingScreen(root:ShadowRoot,signal:AbortSignal):LoadingGate;
