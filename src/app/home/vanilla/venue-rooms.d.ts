export function createRoomBrowser(container:HTMLElement,signal:AbortSignal):{preload:()=>Promise<unknown>;cancel:()=>void;show:(level:number,onLevel:(level:number)=>void)=>Promise<void>};
