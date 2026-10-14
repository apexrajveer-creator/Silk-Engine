// The island's interface logic: tabs, readings, formatting, sparklines, and the double-tap rule for destructive power actions.
import test from 'node:test';
import assert from 'node:assert/strict';

const m = await import('../src/island/model.js');
const { TABS, nextTab, clampPct, pushSample, sparkline, fmtDuration, fmtAge, fmtGb, memoryUse, monogram, peekText, describeQuick, volumeLevel, DESTRUCTIVE, powerStep, stillArmed, inPreviewZone } = m;

// ---- tabs
test('there are six tabs, in the order the toolbar shows them, with unique ids', () => {
  assert.deepEqual(TABS.map(t => t.id), ['quick', 'clipboard', 'system', 'apps', 'wallpapers', 'power']);
  assert.equal(new Set(TABS.map(t => t.id)).size, 6);
  assert.ok(TABS.every(t => t.label.length > 2));
});
test('arrow keys move one tab along', () => {
  assert.equal(nextTab('quick', 1), 'clipboard');
  assert.equal(nextTab('clipboard', 1), 'system');
  assert.equal(nextTab('apps', -1), 'system');
});
test('moving past either end wraps around', () => {
  assert.equal(nextTab('power', 1), 'quick');
  assert.equal(nextTab('quick', -1), 'power');
});
test('big or odd steps still land on a real tab', () => {
  for (const dir of [0, 1, -1, 7, -7, 600, -600, 1.9, NaN, Infinity, undefined]) assert.ok(TABS.some(t => t.id === nextTab('apps', dir)), String(dir));
  assert.equal(nextTab('apps', 0), 'apps');
  assert.equal(nextTab('apps', 6), 'apps', 'a full lap is no move');
  assert.equal(nextTab('apps', NaN), 'apps');
});
test('an unknown current tab counts as the first', () => {
  assert.equal(nextTab('nope', 1), 'clipboard');
  assert.equal(nextTab(undefined, 0), 'quick');
});

// ---- readings
test('clampPct keeps a percentage between 0 and 100', () => {
  assert.equal(clampPct(42.5), 42.5);
  assert.equal(clampPct(-5), 0);
  assert.equal(clampPct(250), 100);
  assert.equal(clampPct('37'), 37);
});
test('clampPct says "no reading" for anything that is not a number', () => {
  for (const bad of [null, undefined, '', NaN, Infinity, 'abc', {}, [], true, false]) assert.equal(clampPct(bad), null, String(bad));
});
test('pushSample keeps only the newest readings', () => {
  assert.deepEqual(pushSample([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(pushSample([], 1, 3), [1]);
  assert.equal(pushSample(Array(100).fill(1), 2, 60).length, 60);
});
test('pushSample never changes the list it was given', () => {
  const a = [1, 2, 3]; pushSample(a, 4, 3); assert.deepEqual(a, [1, 2, 3]);
});

// ---- sparkline
test('a sparkline is a path from the left edge to the right edge', () => {
  const p = sparkline([0, 50, 100], 100, 40);
  assert.equal(p, 'M0.0 40.0L50.0 20.0L100.0 0.0');
});
test('a sparkline needs at least two readings, and a sane scale', () => {
  assert.equal(sparkline([]), '');
  assert.equal(sparkline([5]), '');
  assert.equal(sparkline([1, 2], 100, 10, 0), '');
  assert.equal(sparkline([1, 2], 100, 10, NaN), '');
});
test('a missing reading repeats the one before it instead of leaving a hole', () => {
  assert.equal(sparkline([50, null, 50], 100, 40), sparkline([50, 50, 50], 100, 40));
  assert.equal(sparkline([null, 100], 100, 40), 'M0.0 40.0L100.0 0.0', 'nothing before it: starts at zero');
});
test('a sparkline stays inside its box whatever the readings', () => {
  for (const values of [[-50, 500, 1e9, NaN, 'x'], Array(200).fill(100), Array(200).fill(0)]) {
    const nums = sparkline(values, 120, 32).match(/-?\d+\.\d/g).map(Number);
    for (let i = 0; i < nums.length; i += 2) assert.ok(nums[i] >= 0 && nums[i] <= 120 && nums[i + 1] >= 0 && nums[i + 1] <= 32, `${nums[i]},${nums[i + 1]}`);
  }
});
test('a sparkline can use a different maximum', () => {
  assert.equal(sparkline([0, 50], 100, 10, 50), 'M0.0 10.0L100.0 0.0');
});

// ---- formatting
test('durations read as minutes, then hours and minutes', () => {
  assert.equal(fmtDuration(0), '<1m'); assert.equal(fmtDuration(59), '<1m');
  assert.equal(fmtDuration(60), '1m'); assert.equal(fmtDuration(3599), '59m');
  assert.equal(fmtDuration(3600), '1h 00m'); assert.equal(fmtDuration(3725), '1h 02m'); assert.equal(fmtDuration(36000 + 59 * 60), '10h 59m');
});
test('durations tolerate nonsense', () => {
  for (const bad of [-5, NaN, Infinity, undefined, null, 'x']) assert.equal(fmtDuration(bad), '<1m', String(bad));
});
test('ages read from "now" up to days', () => {
  assert.equal(fmtAge(0), 'now'); assert.equal(fmtAge(4), 'now'); assert.equal(fmtAge(5), '5s'); assert.equal(fmtAge(59), '59s');
  assert.equal(fmtAge(60), '1m'); assert.equal(fmtAge(3599), '59m'); assert.equal(fmtAge(3600), '1h'); assert.equal(fmtAge(86399), '23h'); assert.equal(fmtAge(86400), '1d'); assert.equal(fmtAge(86400 * 30), '30d');
});
test('ages tolerate nonsense', () => {
  for (const bad of [-100, NaN, undefined, null]) assert.equal(fmtAge(bad), 'now', String(bad));
});
test('memory sizes show gigabytes with one decimal, or a dash', () => {
  assert.equal(fmtGb(2 ** 30), '1.0 GB'); assert.equal(fmtGb(7.44 * 2 ** 30), '7.4 GB'); assert.equal(fmtGb(0), '0.0 GB');
  for (const bad of [-1, NaN, null, undefined, 'x']) assert.equal(fmtGb(bad), '\u2014', String(bad));
});
test('memory in use is total minus available, with its percentage', () => {
  const r = memoryUse(16 * 2 ** 30, 4 * 2 ** 30);
  assert.equal(r.used, 12 * 2 ** 30); assert.equal(r.pct, 75);
});
test('memory in use copes with bad totals', () => {
  assert.equal(memoryUse(0, 0), null); assert.equal(memoryUse(NaN, 1), null); assert.equal(memoryUse(10, -1), null); assert.equal(memoryUse(null, null), null);
  assert.equal(memoryUse(10, 99).used, 0, 'more available than total can only mean none in use');
});

// ---- monogram
test('a monogram is the first letter or digit, upper-cased', () => {
  assert.equal(monogram('chrome').letter, 'C'); assert.equal(monogram('  7zip').letter, '7'); assert.equal(monogram('Éclair').letter, 'É'); assert.equal(monogram('日本語').letter, '日');
});
test('a name with no letters gets a question mark, and nonsense does not throw', () => {
  for (const bad of ['', '   ', '---', '!!!', null, undefined, 42]) assert.doesNotThrow(() => monogram(bad));
  assert.equal(monogram('').letter, '?'); assert.equal(monogram('---').letter, '?');
});
test('a monogram hue is stable, in range, and differs between names', () => {
  assert.equal(monogram('Firefox').hue, monogram('Firefox').hue);
  for (const n of ['a', 'Chrome', 'Visual Studio Code', '日本語', '😀']) { const h = monogram(n).hue; assert.ok(Number.isInteger(h) && h >= 0 && h < 360, `${n} -> ${h}`); }
  assert.notEqual(monogram('Chrome').hue, monogram('Firefox').hue);
});

// ---- the peek bar
test('the peek bar shows the time and rounded readings', () => {
  const p = peekText({ cpu: 23.4, ram: 61.6 }, new Date(2026, 9, 12, 7, 5));
  assert.deepEqual(p, { time: '07:05', cpu: '23%', ram: '62%' });
});
test('the peek bar shows dashes while there is no reading', () => {
  assert.deepEqual(peekText({ cpu: null, ram: undefined }, new Date(2026, 0, 1, 23, 59)), { time: '23:59', cpu: '--', ram: '--' });
  assert.equal(peekText(undefined, new Date(2026, 0, 1, 0, 0)).cpu, '--');
  assert.equal(peekText(null).time.length, 5);
});
test('the peek bar clamps wild readings', () => {
  assert.equal(peekText({ cpu: 900 }).cpu, '100%'); assert.equal(peekText({ cpu: -9 }).cpu, '0%');
});

// ---- quick tiles
test('a switch is on, off, or unavailable when this PC has no such adapter', () => {
  assert.deepEqual(describeQuick({ wifi: true, bluetooth: false, muted: true }), { wifi: 'on', bluetooth: 'off', mute: 'on' });
  assert.deepEqual(describeQuick({ wifi: null, bluetooth: null, muted: null }), { wifi: 'unavailable', bluetooth: 'unavailable', mute: 'unavailable' });
});
test('describeQuick copes with an empty or missing answer', () => {
  assert.deepEqual(describeQuick({}), { wifi: 'unavailable', bluetooth: 'unavailable', mute: 'unavailable' });
  assert.doesNotThrow(() => describeQuick(undefined));
});
test('the speaker icon follows the level and the mute switch', () => {
  assert.equal(volumeLevel(0.8, true), 0, 'muted'); assert.equal(volumeLevel(0, false), 0);
  assert.equal(volumeLevel(0.1, false), 1); assert.equal(volumeLevel(0.5, false), 2); assert.equal(volumeLevel(0.9, false), 3);
  assert.equal(volumeLevel(NaN, false), 0); assert.equal(volumeLevel(9, false), 3); assert.equal(volumeLevel(-1, false), 0);
});

// ---- the double-tap rule
test('which power actions need a second tap', () => {
  assert.deepEqual([...DESTRUCTIVE].sort(), ['restart', 'shutdown', 'signout']);
});
test('sleep and lock go straight through', () => {
  for (const a of ['sleep', 'lock']) assert.deepEqual(powerStep(null, a, 1000), { armed: null, at: 0, perform: true });
});
test('the first tap on shut down only arms it', () => {
  assert.deepEqual(powerStep(null, 'shutdown', 5000), { armed: 'shutdown', at: 5000, perform: false });
});
test('a second tap on the same button within three seconds does it', () => {
  const first = powerStep(null, 'restart', 1000);
  assert.deepEqual(powerStep(first, 'restart', 3999), { armed: null, at: 0, perform: true });
  assert.equal(powerStep(first, 'restart', 4000).perform, true, 'exactly at the limit still counts');
});
test('a second tap that is too late only arms it again', () => {
  const first = powerStep(null, 'restart', 1000);
  const late = powerStep(first, 'restart', 4001);
  assert.deepEqual(late, { armed: 'restart', at: 4001, perform: false });
});
test('tapping a different destructive button moves the arming instead of doing either', () => {
  const first = powerStep(null, 'restart', 1000);
  const other = powerStep(first, 'shutdown', 1500);
  assert.deepEqual(other, { armed: 'shutdown', at: 1500, perform: false });
  assert.equal(powerStep(other, 'restart', 1600).perform, false, 'and restart is no longer armed');
});
test('a harmless tap in between does not disturb nothing, and a destructive action still needs its own two taps', () => {
  const armed = powerStep(null, 'shutdown', 1000);
  assert.equal(powerStep(armed, 'lock', 1200).perform, true);
  assert.equal(powerStep({ armed: null, at: 0 }, 'shutdown', 1300).perform, false, 'the lock tap cleared the arming');
});
test('an arming never lasts forever, and a clock that jumps backwards cannot confirm', () => {
  assert.equal(stillArmed({ armed: 'restart', at: 1000 }, 3999), true);
  assert.equal(stillArmed({ armed: 'restart', at: 1000 }, 4001), false);
  assert.equal(stillArmed({ armed: 'restart', at: 5000 }, 4000), false, 'time going backwards');
  assert.equal(stillArmed({ armed: null, at: 0 }, 1), false);
  assert.equal(stillArmed(undefined, 1), false);
  assert.equal(powerStep({ armed: 'restart', at: 5000 }, 'restart', 4000).perform, false);
});
test('nothing but the three session-ending actions can ever need arming', () => {
  for (const a of ['', 'format', 'SHUTDOWN', 'shutdown ', undefined, null]) assert.equal(powerStep(null, a, 1).perform, true, `${a} is not a power action the island sends`);
});

// ---- the preview hot zone mirrors the real one
test('the preview hot zone is a thin strip in the top-centre', () => {
  assert.equal(inPreviewZone(500, 0, 1000), true);
  assert.equal(inPreviewZone(500, 2, 1000), true);
  assert.equal(inPreviewZone(350, 1, 1000), true, 'the zone is 300 wide');
  assert.equal(inPreviewZone(349, 1, 1000), false);
  assert.equal(inPreviewZone(651, 1, 1000), false);
  assert.equal(inPreviewZone(500, 3, 1000), false);
});

// ---- the media card
const { fmtClock, livePosition, progressPct, mediaMode, mediaLines } = m;
test('track times read as m:ss, and h:mm:ss for long ones', () => {
  assert.equal(fmtClock(0), '0:00'); assert.equal(fmtClock(5), '0:05'); assert.equal(fmtClock(59.9), '0:59'); assert.equal(fmtClock(60), '1:00');
  assert.equal(fmtClock(185), '3:05'); assert.equal(fmtClock(3599), '59:59'); assert.equal(fmtClock(3600), '1:00:00'); assert.equal(fmtClock(3723), '1:02:03'); assert.equal(fmtClock(36000), '10:00:00');
});
test('track times tolerate nonsense', () => {
  for (const bad of [-5, NaN, Infinity, undefined, null, 'x']) assert.equal(fmtClock(bad), '0:00', String(bad));
});
const playing = { active: true, status: 'playing', position: 30, duration: 200 };
test('while playing, the position moves on by the time since the app last reported', () => {
  assert.equal(livePosition(playing, 0), 30); assert.equal(livePosition(playing, 5000), 35); assert.equal(livePosition(playing, 1500), 31.5);
});
test('while paused the position stays put', () => {
  assert.equal(livePosition({ ...playing, status: 'paused' }, 5000), 30);
  assert.equal(livePosition({ ...playing, status: 'stopped' }, 5000), 30);
});
test('the position never runs past the end of the track', () => {
  assert.equal(livePosition({ ...playing, position: 198 }, 60_000), 200);
});
test('a live stream has no end, so it just keeps counting', () => {
  assert.equal(livePosition({ ...playing, duration: 0 }, 10_000), 40);
});
test('the position copes with missing or broken numbers and with nothing playing', () => {
  assert.equal(livePosition({ ...playing, position: NaN }, 2000), 2); assert.equal(livePosition({ ...playing, position: -9 }, 0), 0);
  assert.equal(livePosition(playing, NaN), 30); assert.equal(livePosition(playing, -500), 30);
  assert.equal(livePosition(undefined, 1000), 0); assert.equal(livePosition({ active: false }, 1000), 0);
});
test('progress is the share played, kept between 0 and 100', () => {
  assert.equal(progressPct(50, 200), 25); assert.equal(progressPct(0, 200), 0); assert.equal(progressPct(200, 200), 100);
  assert.equal(progressPct(999, 200), 100); assert.equal(progressPct(-5, 200), 0);
});
test('progress is zero when the length is unknown or the numbers are broken', () => {
  for (const [p, d] of [[10, 0], [10, NaN], [NaN, 100], [10, -5], [undefined, undefined]]) assert.equal(progressPct(p, d), 0, `${p}/${d}`);
});
test('the card is in one of three modes', () => {
  assert.equal(mediaMode(undefined), 'none'); assert.equal(mediaMode({ active: false }), 'none');
  assert.equal(mediaMode({ active: true, status: 'playing' }), 'playing'); assert.equal(mediaMode({ active: true, status: 'paused' }), 'paused'); assert.equal(mediaMode({ active: true, status: 'stopped' }), 'paused');
});
test('the card always has a title, and falls back from artist to album', () => {
  assert.deepEqual(mediaLines({ active: true, title: 'Song', artist: 'Band', album: 'LP', app: 'Spotify' }), { title: 'Song', subtitle: 'Band', source: 'Spotify' });
  assert.equal(mediaLines({ active: true, title: 'Song', artist: '', album: 'LP' }).subtitle, 'LP');
  assert.equal(mediaLines({ active: true, title: '', artist: '' }).title, 'Unknown title');
  assert.equal(mediaLines({ active: true, title: 'Song' }).subtitle, '');
});
test('with nothing playing the card says so calmly', () => {
  for (const none of [undefined, null, { active: false }]) { const l = mediaLines(none); assert.equal(l.title, 'Nothing playing'); assert.ok(l.subtitle.length > 10); assert.equal(l.source, ''); }
});
