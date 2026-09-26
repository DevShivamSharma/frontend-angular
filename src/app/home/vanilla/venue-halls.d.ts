export function createHallBrowser(container:HTMLElement,signal:AbortSignal):{preload:()=>Promise<unknown>;cancel:()=>void;show:(hall:string)=>Promise<void>};
