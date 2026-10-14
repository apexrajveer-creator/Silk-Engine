import { test, expect } from '@playwright/test';
async function open(page) { await page.goto('/island.html?peek'); await page.locator('#peek').click(); await expect(page.locator('#island')).toHaveAttribute('data-state','open'); }
test('volume icon reveals themed app sliders and an output selector',async({page})=>{
 await open(page);const toggle=page.getByRole('button',{name:'App volumes and audio output'});await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('slider',{name:'Spotify volume on Speakers'})).toHaveValue('80');await expect(page.getByRole('slider',{name:'Google Chrome volume on Speakers'})).toHaveValue('50');
 await page.locator('.output-button').click();await page.getByRole('button',{name:'Headphones',exact:true}).click();await expect(page.locator('.output-button')).toHaveText('Headphones');await expect(page.locator('#audioOutputs')).toBeHidden();
 await expect(page.getByRole('slider',{name:'Spotify volume on Headphones'})).toBeVisible();
 await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(page.locator('#audioMixer')).toHaveAttribute('aria-hidden','true');
});
test('mixer keyboard changes persist through refresh and maintain focus',async({page})=>{
 await open(page);await page.getByRole('button',{name:'App volumes and audio output'}).click();const slider=page.getByRole('slider',{name:'Spotify volume on Speakers'});await slider.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await expect(slider).toHaveValue('1');
 await expect.poll(()=>page.evaluate(()=>globalThis.__islandMock.log.some(e=>e[0]==='mixer_volume'&&e[1]==='spotify'&&e[2]===.01))).toBe(true);await expect(slider).toBeFocused();
});
test('media cover activates the source without changing transport playback',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Open Spotify',exact:true}).click();await expect.poll(()=>page.evaluate(()=>globalThis.__islandMock.log.some(e=>e[0]==='media_open'))).toBe(true);await expect(page.locator('#island')).toHaveAttribute('data-state','hidden');
});
