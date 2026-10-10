// Hero title cleaning (src/shared/titles.js).
const test = require('node:test'), assert = require('node:assert/strict');
const load = () => import('../src/shared/titles.js');
test('strips trailing filler from wallpaper filenames', async () => {
  const { cleanTitle } = await load();
  assert.equal(cleanTitle('Cat In The Swamp Live Wallpaper 4K Dark Animated Background'), 'Cat In The Swamp');
  assert.equal(cleanTitle('Nissan GTR R34 Skyline Live Wallpaper'), 'Nissan GTR R34 Skyline');
  assert.equal(cleanTitle('Travis_Scott_-_CAN_T_SAY_Official'), 'Travis Scott - CAN T SAY');
  assert.equal(cleanTitle('Drake - Life is Good (Official Video) [4K]'), 'Drake - Life is Good');
  assert.equal(cleanTitle('Pinat TC-IYC - https://t.co/abc'), 'Pinat TC-IYC');
});
test('never removes meaningful words, even ones that look like filler', async () => {
  const { cleanTitle } = await load();
  assert.equal(cleanTitle('The Dark Knight'), 'The Dark Knight');
  assert.equal(cleanTitle('The Batman 2022'), 'The Batman 2022');
  assert.equal(cleanTitle('Living Silk'), 'Living Silk');
  assert.equal(cleanTitle('4K Red Bull RB22 Onboard'), '4K Red Bull RB22 Onboard');
});
test('always leaves something to show', async () => {
  const { cleanTitle } = await load();
  assert.equal(cleanTitle('Live Wallpaper 4K'), 'Live');
  assert.equal(cleanTitle(''), 'Untitled');
  assert.equal(cleanTitle(null), 'Untitled');
  assert.equal(cleanTitle('[4K]'), '[4K]');
});
