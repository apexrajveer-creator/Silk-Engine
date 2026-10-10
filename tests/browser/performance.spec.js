import { test, expect } from '@playwright/test';
// Frame-rate measurement. Trace recording screenshots every changed frame, which distorts frame
// timing once the cinematic hero is moving, so recording is off for this file.
test.use({ trace: 'off' });

test('Startup never starves the interface: no blocking readbacks, frames keep flowing at 2x scale',async({page})=>{
 await page.addInitScript(()=>{window.__dataURL=0;const o=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...a){window.__dataURL++;return o.apply(this,a);};});
 await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
 // The entrance animations settle in about a second; the 0.9.3 bug held 1-4 fps for 20+ s.
 await page.waitForTimeout(1500);
 const fps=await page.evaluate(()=>new Promise(r=>{let n=0;const s=performance.now();const f=()=>{n++;if(performance.now()-s<1500)requestAnimationFrame(f);else r(n/1.5);};requestAnimationFrame(f);}));
 expect(fps).toBeGreaterThan(40);
 expect(await page.evaluate(()=>window.__dataURL)).toBe(0);
 await expect(page.locator('#scenes .wcard[data-id="builtin-silk"] .art img')).toHaveAttribute('src',/assets\/thumbs\/silk\.webp/);
});
