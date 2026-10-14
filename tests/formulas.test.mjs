// Rainmeter skins carry formulas written by strangers. The evaluator must compute honest arithmetic correctly and REFUSE
// everything else, never executing it. Also covered: colours, time formats, measures and the audio-band smoothing.
import test from 'node:test';
import assert from 'node:assert/strict';

const { arithmetic, rainColor, timeFormat, measureValues } = await import('../src/widgets/rainmeter.js');
const { smoothBands } = await import('../src/widgets/draw.js');

// ---------------------------------------------------------------- honest arithmetic
const cases = [
  ['1+2*3', 7], ['(1+2)*3', 9], ['10/4', 2.5], ['10%4', 2], ['2*-3', -6], ['-(2+3)', -5], ['+5', 5], ['--5', 5], ['1-1-1', -1],
  ['8/4/2', 1], ['2*3%4', 2], ['.5+.25', .75], ['1.5*2', 3], ['  1 +  2 ', 3], ['((((7))))', 7], ['2*(3+4)*5', 70], ['100-10*9', 10], ['0', 0], ['7%3*2', 2],
];
for (const [formula, want] of cases) test(`arithmetic: ${formula} = ${want}`, () => assert.equal(arithmetic(formula), want));

test('arithmetic: dividing or taking a remainder by zero gives 0 instead of Infinity or NaN', () => {
  for (const f of ['5/0', '5%0', '1/(1-1)', '0/0', '-3/0']) assert.equal(arithmetic(f), 0, f);
});
test('arithmetic: [Variables] and bare names come from the supplied values, case-insensitively', () => {
  assert.equal(arithmetic('[a]+[b]*2', { a: 1, b: 3 }), 7);
  assert.equal(arithmetic('A+B', { a: 4, b: 5 }), 9);
  assert.equal(arithmetic('[Cpu]/2', { cpu: 50 }), 25);
});
test('arithmetic: a value that is not a number counts as zero', () => {
  assert.equal(arithmetic('a+1', { a: 'text' }), 1);
  assert.equal(arithmetic('a+1', { a: undefined }), 1);
  assert.equal(arithmetic('a+1', { a: NaN }), 1);
});
test('arithmetic: an unknown name is an error, and inherited names are never "found"', () => {
  assert.throws(() => arithmetic('nope', {}), /Unknown formula value/);
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) assert.throws(() => arithmetic(name, {}), Error, name);
});

// ---------------------------------------------------------------- hostile and malformed input is refused, never executed
globalThis.__executed = false;
const hostile = ['process.exit()', 'alert(1)', 'globalThis.__executed=true', '1;globalThis.__executed=true', 'a.b', '`x`', '"x"', "'x'", '1&&2', '1||2', '1<2', '1>2', '!1', '~1', '1^2', 'a=1', 'a?1:2',
  '{}', '[]', 'x=>x', 'import("x")', 'eval("1")', 'Function("return 1")()', '1,2', '1 2', '2**3', '1e999', '0x10', '1_000', '1//2', '/*x*/1', '1\u202e2', 'a\0b'];
for (const f of hostile) test(`hostile formula refused: ${JSON.stringify(f)}`, () => {
  assert.throws(() => arithmetic(f, {}), Error);
  assert.equal(globalThis.__executed, false, 'it ran code');
});
for (const f of ['', ' ', '1+', '*2', '(', ')', '(1', '1)', '()', '+', '-', '1+*2', '(1+2']) test(`incomplete formula refused: ${JSON.stringify(f)}`, () => assert.throws(() => arithmetic(f), Error));

test('arithmetic: a formula over 4,096 characters is refused', () => {
  assert.throws(() => arithmetic('1+'.repeat(2049) + '1'), /size limit/);
  assert.equal(arithmetic('1' + ' '.repeat(4000) + '+1'), 2, 'long but under the limit is fine');
});
test('arithmetic: more than 256 tokens is refused, 255 is fine', () => {
  assert.throws(() => arithmetic('1+'.repeat(150) + '1'), /complexity/);
  assert.equal(arithmetic('1+'.repeat(127) + '1'), 128);
});
test('arithmetic: deep nesting cannot blow the stack', () => {
  assert.equal(arithmetic('('.repeat(120) + '1' + ')'.repeat(120)), 1);
  assert.throws(() => arithmetic('('.repeat(300) + '1' + ')'.repeat(300)), /complexity/);
});
test('arithmetic: results that overflow to Infinity are refused', () => {
  const big = '1' + '0'.repeat(200);
  assert.throws(() => arithmetic(`${big}*${big}`), /Invalid formula/);
  assert.throws(() => arithmetic('9'.repeat(400)), /Invalid formula/);
});

// a deterministic fuzz: random junk either computes a finite number or throws an Error; nothing else, and nothing hangs
test('arithmetic fuzz: 800 random formulas always end in a finite number or an Error', () => {
  const alphabet = ['1', '2', '3', '0', '.', '+', '-', '*', '/', '%', '(', ')', ' ', 'a', 'b', '[a]', '[b]', 'x', '_', ';', '=', '"', '\\', '$', '{', '}', '\n'];
  let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let ok = 0, refused = 0;
  const started = Date.now();
  for (let i = 0; i < 800; i++) {
    const f = Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    try { const v = arithmetic(f, { a: 3, b: 5 }); assert.ok(Number.isFinite(v), `${JSON.stringify(f)} -> ${v}`); ok++; }
    catch (e) { assert.ok(e instanceof Error && e.constructor === Error, `${JSON.stringify(f)} threw ${e?.constructor?.name}: ${e?.message}`); refused++; }
  }
  assert.ok(ok > 5 && refused > 5, `the fuzz should reach both outcomes (${ok} ok, ${refused} refused)`);
  assert.ok(Date.now() - started < 3000, 'no formula may take long');
});

// ---------------------------------------------------------------- colours
test('rainColor: hex colours with or without #, six or eight digits', () => {
  assert.equal(rainColor('#ff8800'), '#ff8800');
  assert.equal(rainColor('ff8800'), '#ff8800');
  assert.equal(rainColor('#FF880080'), '#FF880080');
});
test('rainColor: comma-separated channels become rgba, with alpha scaled from 255', () => {
  assert.equal(rainColor('255,128,0'), 'rgba(255,128,0,1)');
  assert.equal(rainColor('255,128,0,0'), 'rgba(255,128,0,0)');
  assert.equal(rainColor('0,0,0,255'), 'rgba(0,0,0,1)');
  assert.match(rainColor('1,2,3,128'), /^rgba\(1,2,3,0\.50\d+\)$/);
});
test('rainColor: channels are clamped to 0..255', () => {
  assert.equal(rainColor('300,-5,999'), 'rgba(255,0,255,1)');
  assert.equal(rainColor('1,2,3,999'), 'rgba(1,2,3,1)');
  assert.equal(rainColor('1,2,3,-9'), 'rgba(1,2,3,0)');
});
test('rainColor: anything unusable gives the fallback', () => {
  for (const bad of ['', undefined, null, 'red', '1,2', 'a,b,c', '255,128,NaN', '#12345', '#gggggg', {}, 5]) assert.equal(rainColor(bad), '#ffffff', String(bad));
  assert.equal(rainColor('nope', '#123456'), '#123456');
});
test('rainColor never lets markup through', () => {
  for (const evil of ['red;background:url(x)', '1,2,3);alert(1', 'expression(1)', '"><script>']) assert.doesNotMatch(rainColor(evil), /[;<>"]|url|alert|expression/i, evil);
});

// ---------------------------------------------------------------- time formatting
const when = (h, m = 5, s = 9) => new Date(2026, 9, 12, h, m, s);   // 12 October 2026
test('timeFormat: 24-hour clock with zero padding', () => assert.equal(timeFormat(when(14), '%H:%M:%S'), '14:05:09'));
test('timeFormat: 12-hour clock and AM/PM, including midnight and noon', () => {
  assert.equal(timeFormat(when(14), '%I:%M %p'), '02:05 PM');
  assert.equal(timeFormat(when(0), '%I %p'), '12 AM');
  assert.equal(timeFormat(when(12), '%I %p'), '12 PM');
  assert.equal(timeFormat(when(23, 59), '%I:%M %p'), '11:59 PM');
});
test('timeFormat: dates', () => {
  assert.equal(timeFormat(when(14), '%d/%m/%Y'), '12/10/2026');
  assert.equal(timeFormat(when(14), '%y'), '26');
});
test('timeFormat: a # strips the leading zero', () => {
  assert.equal(timeFormat(when(14), '%#I'), '2');
  assert.equal(timeFormat(when(14), '%#M'), '5');
  assert.equal(timeFormat(when(0, 0, 0), '%#H'), '0');
  assert.equal(timeFormat(when(14), '%#d'), '12');
});
test('timeFormat: %% is a percent sign, unknown codes and plain text are left alone', () => {
  assert.equal(timeFormat(when(14), '100%%'), '100%');
  assert.equal(timeFormat(when(14), '%Q %Z'), '%Q %Z');
  assert.equal(timeFormat(when(14), 'no codes'), 'no codes');
  assert.equal(timeFormat(when(14), ''), '');
  assert.equal(timeFormat(when(14), '%H%M'), '1405');
});
test('timeFormat: weekday and month names come back as words', () => {
  assert.match(timeFormat(when(14), '%A'), /^[A-Za-z\u00C0-\u024F]{3,}/);
  assert.ok(timeFormat(when(14), '%B').length >= 3);
});

// ---------------------------------------------------------------- measures
const state = (over = {}) => ({ now: when(14, 30, 0), metrics: { cpu: 42.6, ram: 63.2, uptime: 3725.9 }, bands: Array(32).fill(0), ...over });
test('measureValues: time, cpu, memory and uptime', () => {
  const v = measureValues({ measures: [{ name: 'h', kind: 'time', format: '%H' }, { name: 'c', kind: 'cpu' }, { name: 'r', kind: 'memory' }, { name: 'u', kind: 'uptime' }] }, state());
  assert.equal(v.h.text, '14'); assert.equal(v.h.value, 14);
  assert.equal(v.c.text, '43'); assert.equal(v.c.value, 42.6);
  assert.equal(v.r.text, '63');
  assert.equal(v.u.text, '3725');
});
test('measureValues: missing metrics show a dash and count as zero', () => {
  const v = measureValues({ measures: [{ name: 'c', kind: 'cpu' }, { name: 'r', kind: 'memory' }] }, state({ metrics: { cpu: null, ram: null } }));
  assert.equal(v.c.text, '—'); assert.equal(v.c.value, 0); assert.equal(v.r.text, '—');
});
test('measureValues: audio by band or as the loudest band', () => {
  const bands = Array(32).fill(0); bands[3] = .4; bands[9] = .8;
  const v = measureValues({ measures: [{ name: 'b', kind: 'audio', audioType: 'band', band: 3 }, { name: 'm', kind: 'audio', audioType: 'max' }, { name: 'gone', kind: 'audio', audioType: 'band', band: 99 }] }, state({ bands }));
  assert.equal(v.b.value, .4); assert.equal(v.m.value, .8); assert.equal(v.gone.value, 0);
});
test('measureValues: a calculation can use earlier measures, and a broken formula leaves zero', () => {
  const v = measureValues({ measures: [{ name: 'c', kind: 'cpu' }, { name: 'half', kind: 'calc', formula: 'c/2' }, { name: 'bad', kind: 'calc', formula: 'process.exit()' }, { name: 'later', kind: 'calc', formula: 'unknown+1' }] }, state({ metrics: { cpu: 50 } }));
  assert.equal(v.half.value, 25); assert.equal(v.half.text, '25');
  assert.equal(v.bad.value, 0); assert.equal(v.bad.text, '0');
  assert.equal(v.later.value, 0);
});
test('measureValues: an unknown or unsupported kind is a dash', () => {
  const v = measureValues({ measures: [{ name: 'p', kind: 'unsupported' }, { name: 'q', kind: 'who-knows' }] }, state());
  assert.equal(v.p.text, '—'); assert.equal(v.q.text, '—');
});
test('measureValues: measure names like __proto__ cannot corrupt the result object', () => {
  const v = measureValues({ measures: [{ name: '__proto__', kind: 'cpu' }, { name: 'constructor', kind: 'memory' }, { name: 'toString', kind: 'uptime' }] }, state());
  assert.equal(Object.getPrototypeOf(v), null);
  assert.equal(v.constructor.text, '63');
  assert.equal(({}).polluted, undefined);
});
test('measureValues: a skin with no measures gives an empty result', () => {
  assert.deepEqual(Object.keys(measureValues({}, state())), []);
  assert.deepEqual(Object.keys(measureValues({ measures: [] }, state())), []);
});

// ---------------------------------------------------------------- audio band smoothing
test('smoothBands: always 32 values between 0 and 1', () => {
  const out = smoothBands([], []);
  assert.equal(out.length, 32);
  const loud = smoothBands(Array(32).fill(.5), Array(32).fill(9));
  assert.ok(loud.every(v => v >= 0 && v <= 1));
  const quiet = smoothBands(Array(32).fill(.5), Array(32).fill(-9));
  assert.ok(quiet.every(v => v >= 0 && v <= 1));
});
test('smoothBands: it moves towards the target and never overshoots', () => {
  for (const [old, target] of [[0, 1], [1, 0], [.2, .8], [.9, .1]]) {
    const v = smoothBands([old], [target], 65)[0];
    assert.ok(v >= Math.min(old, target) - 1e-9 && v <= Math.max(old, target) + 1e-9, `${old} -> ${target} gave ${v}`);
    assert.notEqual(v, old, 'it should move');
  }
});
test('smoothBands: rises faster than it falls, like a level meter', () => {
  const up = smoothBands([0], [1], 90)[0] - 0, down = 1 - smoothBands([1], [0], 90)[0];
  assert.ok(up > down, `rise ${up} vs fall ${down}`);
});
test('smoothBands: NaN, missing and non-numeric input is treated as silence', () => {
  const out = smoothBands([NaN, undefined, 'x'], [NaN, undefined, 'y']);
  assert.ok(out.every(Number.isFinite));
  assert.ok(out.slice(0, 3).every(v => v === 0));
});
test('smoothBands: repeated updates converge on the target', () => {
  let b = Array(32).fill(0);
  for (let i = 0; i < 60; i++) b = smoothBands(b, Array(32).fill(.7), 65);
  assert.ok(b.every(v => Math.abs(v - .7) < .02), String(b[0]));
});
