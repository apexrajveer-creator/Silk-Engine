import { test, expect } from '@playwright/test';

const open = async page => {
  await page.goto('/island.html?open');
  await expect(page.locator('#island')).toHaveAttribute('data-state', 'open');
  await page.waitForTimeout(1000);
};

test('clipboard polling keeps the focused row, scroll position and settled contents', async ({ page }) => {
  await open(page);
  await page.locator('#tab-clipboard').click();
  await page.getByRole('button', { name: 'Turn on clipboard history' }).click();
  await page.evaluate(() => { for (let i = 0; i < 20; i++) __islandMock.copy(`Clipboard entry ${i}`); });
  await expect(page.locator('.clip')).toHaveCount(20);
  await page.waitForTimeout(1000);
  await page.locator('.clip').first().focus();
  await page.evaluate(() => {
    window.savedClip = document.querySelector('.clip');
    window.savedList = document.querySelector('.clips');
    savedList.scrollTop = 100;
    window.savedScroll = savedList.scrollTop;
  });
  await page.waitForTimeout(2200);
  expect(await page.evaluate(() => ({
    same: savedClip === document.querySelector('.clip'),
    focus: document.activeElement === savedClip,
    scroll: savedList.scrollTop === savedScroll,
    animations: document.getElementById('view-clipboard').getAnimations({ subtree: true }).length,
  }))).toEqual({ same: true, focus: true, scroll: true, animations: 0 });
  await page.evaluate(() => __islandMock.copy('A new copy still arrives'));
  await expect(page.locator('.clip').first()).toContainText('A new copy still arrives', { timeout: 4000 });
});

test('app usage updates in place without replacing its icon or button', async ({ page }) => {
  await open(page);
  await page.locator('#tab-apps').click();
  await page.getByRole('button', { name: 'Start tracking' }).click();
  await page.evaluate(() => __islandMock.use('Spotify', 100));
  await expect(page.locator('.app')).toHaveCount(1, { timeout: 6500 });
  await expect(page.locator('.app img')).toHaveCount(1);
  await page.evaluate(() => {
    window.savedApp = document.querySelector('.app');
    window.savedIcon = savedApp.querySelector('img');
    savedApp.focus(); __islandMock.use('Spotify', 100);
  });
  await expect(page.locator('.app .who small')).toHaveText('3m', { timeout: 6500 });
  expect(await page.evaluate(() => savedApp === document.querySelector('.app') && savedIcon === savedApp.querySelector('img') && document.activeElement === savedApp)).toBe(true);
});

test('media and switch icons survive unchanged polling', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.savedPlay = document.querySelector('.mc.big svg');
    window.savedMute = document.querySelector('.tile[data-id=mute] svg');
  });
  await page.waitForTimeout(4500);
  expect(await page.evaluate(() => savedPlay === document.querySelector('.mc.big svg') && savedMute === document.querySelector('.tile[data-id=mute] svg'))).toBe(true);
});

test('wallpaper playback changes retain loaded images and still update the selection', async ({ page }) => {
  await open(page);
  await page.locator('#tab-wallpapers').click();
  await expect(page.locator('.wall img').first()).toBeVisible();
  await page.evaluate(() => { window.savedWall = document.querySelector('.wall'); window.savedPicture = savedWall.querySelector('img'); });
  await page.getByRole('button', { name: 'Pause or play' }).click();
  expect(await page.evaluate(() => savedWall === document.querySelector('.wall') && savedPicture === savedWall.querySelector('img'))).toBe(true);
  await page.locator('.wall').nth(1).click();
  await expect(page.locator('.wall').nth(1)).toHaveAttribute('aria-current', 'true');
});
