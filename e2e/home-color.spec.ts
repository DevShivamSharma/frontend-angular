import { expect, test } from '@playwright/test';

test.use({trace:'off', launchOptions:{args:process.platform==='win32'?['--use-angle=d3d11']:['--enable-unsafe-swiftshader']}});

test('appearance: lazy palette, stable camera, selection, cached toggles and idle rendering', async ({page},info) => {
  test.setTimeout(150_000);
  const requests: string[] = [], errors: string[] = [];
  page.on('request',r=>{if(/\.glb(?:\?|$)/.test(r.url()))requests.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const p={draws:0,canvas:null as HTMLCanvasElement|null};(window as any).__colorProbe=p;
    const original=HTMLCanvasElement.prototype.getContext as any;
    (HTMLCanvasElement.prototype.getContext as any)=function(type:string,options:any){
      if(type==='webgl2'&&this.getRootNode()?.host?.tagName==='APP-HOME-PAGE'){p.canvas=this;options={...options,preserveDrawingBuffer:true};}
      return original.call(this,type,options);
    };
    const proto=WebGL2RenderingContext.prototype as any;
    for(const name of ['clear','drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
      const method=proto[name];proto[name]=function(...args:any[]){if(this.canvas===p.canvas)p.draws++;return method.apply(this,args);};
    }
  });
  await page.goto('/');await expect(page.locator('#loading')).toBeHidden({timeout:90_000});
  const natural=page.getByRole('button',{name:'Natural',exact:true}),color=page.getByRole('button',{name:'Color',exact:true});
  await expect(natural).toHaveAttribute('aria-pressed','true');
  expect(requests.filter(u=>u.includes('colour-materials'))).toHaveLength(0);
  await page.waitForTimeout(3000);
  const pixels=()=>page.evaluate(()=>(window as any).__colorProbe.canvas.toDataURL());
  const before=await pixels();
  await color.click();await expect(color).toHaveAttribute('aria-pressed','true',{timeout:60_000});
  await page.waitForTimeout(2000);
  const colored=await pixels();expect(colored).not.toBe(before);
  const changedBackground = await page.evaluate(async images => {
    const samples = await Promise.all(images.map(async url => {
      const image = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
      ctx.drawImage(image,0,0); image.close();
      // Upper map strip at the unchanged overview pose, clear of campus geometry.
      return ctx.getImageData(0, Math.floor(canvas.height*.08),canvas.width,Math.floor(canvas.height*.16)).data;
    }));
    let changed = 0;
    for(let i=0;i<samples[0].length;i+=4)
      if([0,1,2].some(c=>Math.abs(samples[0][i+c]-samples[1][i+c])>12)) changed++;
    return changed;
  }, [before,colored]);
  expect(changedBackground, 'Color changes the surrounding map as well as the campus').toBeGreaterThan(10000);
  await page.screenshot({path:info.outputPath('color-overview.png')});
  const draws=await page.evaluate(()=>(window as any).__colorProbe.draws);
  await page.waitForTimeout(1500);
  expect(await pixels()).toBe(colored);
  expect(await page.evaluate(()=>(window as any).__colorProbe.draws)).toBe(draws);
  await natural.click();await expect(natural).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(500);
  expect(await pixels(), 'Returning to Natural restores pixels at the identical camera pose').toBe(before);
  await page.screenshot({path:info.outputPath('natural-overview.png')});
  await page.locator('#halls-group').click();await page.locator('#hall-menu [data-view="hall1"]').click();
  await page.waitForTimeout(1800);await color.click();await expect(color).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#hall-menu [data-view="hall1"]')).toHaveClass(/active/);
  await page.waitForTimeout(500);
  await page.screenshot({path:info.outputPath('color-hall1.png')});
  await natural.click();await expect(natural).toHaveAttribute('aria-pressed','true');
  await color.click();await expect(color).toHaveAttribute('aria-pressed','true');
  expect(requests.filter(u=>u.includes('ARCHITECTURAL'))).toHaveLength(1);
  expect(requests.filter(u=>u.includes('colour-materials'))).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('appearance: failed palette leaves Natural usable and can retry', async ({page})=>{
  test.setTimeout(120_000);
  let failures=1;
  await page.route('**/venue-colour-materials.glb*',r=>failures-->0?r.abort('failed'):r.continue());
  await page.goto('/');await expect(page.locator('#loading')).toBeHidden({timeout:90_000});
  const color=page.getByRole('button',{name:'Color',exact:true});
  await color.click();await expect(page.locator('#appearance-status')).toContainText('retry');
  await expect(page.getByRole('button',{name:'Natural',exact:true})).toHaveAttribute('aria-pressed','true');
  await color.click();await expect(color).toHaveAttribute('aria-pressed','true',{timeout:60_000});
  await expect(page.locator('#appearance-status')).toBeHidden();
});

test('appearance: leaving during a palette request aborts work and releases the viewer', async ({page})=>{
  test.setTimeout(120_000);
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/venue-colour-materials.glb*',async route=>{await gate;await route.continue();});
  await page.goto('/');await expect(page.locator('#loading')).toBeHidden({timeout:90_000});
  await page.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>{
    (window as any).__leavingContext=canvas.getContext('webgl2');
  });
  await page.getByRole('button',{name:'Color',exact:true}).click();
  await expect(page.locator('#appearance-status')).toContainText('Preparing');
  await page.getByRole('link',{name:'Stall planner'}).click();
  await expect(page.locator('app-home-page')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__leavingContext.isContextLost())).toBe(true);
  release();await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
