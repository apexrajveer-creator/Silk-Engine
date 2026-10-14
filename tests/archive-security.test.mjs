// Skins arrive from strangers as .zip / .rmskin files, so the archive reader is attacked here with forged packages: path
// traversal, encryption, lying sizes, zip bombs, truncated and inconsistent records. Every attack must be refused with a
// clear error and nothing may leak out; honest packages must still load.
import test from 'node:test';
import assert from 'node:assert/strict';

const { readArchive, safePath, decodeText, crc32, MAX_ARCHIVE } = await import('../src/widgets/archive.js');
const enc = new TextEncoder();
const bytes = s => enc.encode(s);
const concat = list => { const out = new Uint8Array(list.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of list) { out.set(a, at); at += a.length; } return out; };
const deflateRaw = async data => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

/**
 * A ZIP writer that can lie. entries: { name, data, method (0 stored | 8 deflate), flags, crc, usize, csize, localOffset, packed }.
 * eocd: { disk, cdDisk, count, size, offset, trailer } overrides the end-of-directory record.
 */
async function zip(entries, eocd = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = bytes(e.name), raw = e.data ?? new Uint8Array(0), method = e.method ?? 0;
    const packed = e.packed ?? (method === 8 ? await deflateRaw(raw) : raw);
    const crc = e.crc ?? crc32(raw), usize = e.usize ?? raw.length, csize = e.csize ?? packed.length, flags = e.flags ?? 0;
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, csize, true); lv.setUint32(22, usize, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length), cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, flags, true); cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, csize, true); cv.setUint32(24, usize, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, e.localOffset ?? offset, true);
    cen.set(name, 46);
    central.push(cen); parts.push(local, packed);
    offset += local.length + packed.length;
  }
  const cd = concat(central), end = new Uint8Array(22), ev = new DataView(end.buffer), count = eocd.count ?? entries.length;
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, eocd.disk ?? 0, true); ev.setUint16(6, eocd.cdDisk ?? 0, true);
  ev.setUint16(8, count, true); ev.setUint16(10, count, true); ev.setUint32(12, eocd.size ?? cd.length, true); ev.setUint32(16, eocd.offset ?? offset, true);
  return concat([...parts, cd, end, eocd.trailer ?? new Uint8Array(0)]).buffer;
}
const ini = (name = 'Skin/Skin.ini', text = '[Rainmeter]\nUpdate=1000\n') => ({ name, data: bytes(text) });

// ---------------------------------------------------------------- honest packages still load
test('an honest stored package loads, keeping INI files and images', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const { files } = await readArchive(await zip([ini(), { name: 'Skin/bg.png', data: png }]));
  assert.deepEqual([...files.keys()].sort(), ['skin/bg.png', 'skin/skin.ini']);
  assert.deepEqual(files.get('skin/bg.png').bytes, png);
  assert.equal(new TextDecoder().decode(files.get('skin/skin.ini').bytes), '[Rainmeter]\nUpdate=1000\n');
});
test('a deflate-compressed entry expands to exactly its original bytes', async () => {
  const text = 'abc'.repeat(5_000);
  const { files } = await readArchive(await zip([{ name: 'a.ini', data: bytes(text), method: 8 }]));
  assert.equal(new TextDecoder().decode(files.get('a.ini').bytes), text);
});
test('executables and scripts are reported as skipped and never retained; other files are ignored silently', async () => {
  const { files, skipped } = await readArchive(await zip([ini(), { name: 'run.exe', data: bytes('MZ') }, { name: 'Plugin.dll', data: bytes('MZ') }, { name: 'x.lua', data: bytes('os.exit()') }, { name: 'notes.txt', data: bytes('hi') }, { name: 'evil.js', data: bytes('alert(1)') }, { name: 'folder/', data: new Uint8Array(0) }]));
  assert.deepEqual([...files.keys()], ['skin/skin.ini']);
  assert.deepEqual(skipped.sort(), ['Plugin.dll', 'run.exe', 'x.lua']);
});
test('the short footer Rainmeter appends after the directory is tolerated', async () => {
  const { files } = await readArchive(await zip([ini()], { trailer: bytes('RMSKIN-FOOTER-1234') }));
  assert.equal(files.size, 1);
});
test('an empty package is fine and has no files', async () => {
  const { files } = await readArchive(await zip([]));
  assert.equal(files.size, 0);
});

// ---------------------------------------------------------------- not a package at all
test('random bytes are not a package', async () => {
  await assert.rejects(readArchive(crypto.getRandomValues(new Uint8Array(5_000)).buffer), /not a supported/i);
});
test('an empty or tiny buffer is not a package', async () => {
  for (const n of [0, 1, 21]) await assert.rejects(readArchive(new Uint8Array(n).buffer), /not a supported/i, `${n} bytes`);
});
test('a package over 32 MB is refused before anything else happens', async () => {
  await assert.rejects(readArchive(new Uint8Array(MAX_ARCHIVE + 1).buffer), /smaller than 32 MB/);
});

// ---------------------------------------------------------------- path attacks (zip-slip)
for (const [label, name] of [
  ['parent directory', '../evil.ini'], ['deep parent directory', 'a/b/../../../evil.ini'], ['backslash parent', '..\\..\\evil.ini'],
  ['absolute unix path', '/etc/evil.ini'], ['drive letter', 'C:\\Windows\\evil.ini'], ['lower-case drive letter', 'c:/evil.ini'],
  ['UNC share', '\\\\server\\share\\evil.ini'], ['null byte', 'ok.ini\0.png'],
]) {
  test(`path attack refused: ${label}`, async () => {
    await assert.rejects(readArchive(await zip([{ name, data: bytes('x') }])), Error);
  });
}
test('safePath: normal names pass through, dots collapse and backslashes become slashes', () => {
  assert.equal(safePath('Skin/Skin.ini'), 'Skin/Skin.ini');
  assert.equal(safePath('Skin\\Sub\\a.ini'), 'Skin/Sub/a.ini');
  assert.equal(safePath('./a/./b.ini'), 'a/b.ini');
  assert.equal(safePath('a/b/../c.ini'), 'a/c.ini', 'going up inside the package is fine');
  assert.equal(safePath('a//b.ini'), 'a/b.ini');
});
test('safePath: anything that would leave the package is refused', () => {
  for (const bad of ['..', '../x', 'a/../../x', '/x', '\\x', 'C:x', 'c:\\x', 'x\0y']) assert.throws(() => safePath(bad), Error, JSON.stringify(bad));
});

// ---------------------------------------------------------------- forged structure and sizes
test('an encrypted entry is refused', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), flags: 1 }])), /encrypted/i);
});
test('an unsupported compression method is refused', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), method: 12 }])), /compression/i);
});
test('duplicate paths are refused, even when only the case differs', async () => {
  await assert.rejects(readArchive(await zip([ini('A.ini'), ini('a.INI')])), /duplicate/i);
});
test('a wrong checksum is refused', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), crc: 0xdeadbeef }])), /checksum/i);
});
test('a declared size that does not match the data is refused', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), usize: 5 }])), /checksum|exceeds/i);
});
test('an entry declaring more than 8 MB expanded is refused without being read', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), usize: 9 * 1024 * 1024 }])), /24 MB expanded limit/);
});
test('a zip bomb that lies about its size is stopped while expanding', async () => {
  const bomb = new Uint8Array(20 * 1024 * 1024);                        // 20 MB of zeros squeezes into a few KB
  await assert.rejects(readArchive(await zip([{ name: 'bomb.ini', data: bomb, method: 8, usize: 100 }])), /exceeds its size limit/);
});
test('the total expanded size of all entries is capped at 24 MB', async () => {
  const chunk = () => new Uint8Array(7.9 * 1024 * 1024).fill(65);
  await assert.rejects(readArchive(await zip([{ name: 'a.ini', data: chunk() }, { name: 'b.ini', data: chunk() }, { name: 'c.ini', data: chunk() }, { name: 'd.ini', data: new Uint8Array(1024 * 1024).fill(66) }])), /24 MB expanded limit/);
});
test('more than 2,000 entries is refused', async () => {
  await assert.rejects(readArchive(await zip([ini()], { count: 2001 })), /oversized|ZIP64/i);
});
test('a ZIP64 marker is refused', async () => {
  await assert.rejects(readArchive(await zip([ini()], { count: 65535 })), /ZIP64/i);
});
test('a multi-disk (split) archive is refused', async () => {
  await assert.rejects(readArchive(await zip([ini()], { disk: 1 })), /Split|ZIP64/i);
  await assert.rejects(readArchive(await zip([ini()], { cdDisk: 1 })), /Split|ZIP64/i);
});
test('a directory that claims to extend past the end of the file is refused', async () => {
  await assert.rejects(readArchive(await zip([ini()], { size: 1_000_000 })), /oversized|ZIP64/i);
});
test('a directory that is shorter than its own records is refused as truncated', async () => {
  await assert.rejects(readArchive(await zip([ini()], { size: 20 })), /Truncated|Invalid ZIP directory/i);
});
test('a local header offset pointing at garbage is refused', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), localOffset: 3 }])), /Invalid ZIP entry/i);
  await assert.rejects(readArchive(await zip([{ ...ini(), localOffset: 4_000_000 }])), /Invalid ZIP entry/i);
});
test('an entry whose data would run past the directory is refused as truncated', async () => {
  await assert.rejects(readArchive(await zip([{ ...ini(), csize: 1_000_000 }])), /Truncated ZIP entry/i);
});
test('a package whose directory offset is wrong is refused', async () => {
  await assert.rejects(readArchive(await zip([ini()], { offset: 1 })), Error);
});

// ---------------------------------------------------------------- the small helpers
test('crc32 matches the published check values', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(bytes('a')), 0xe8b7be43);
  assert.equal(crc32(new Uint8Array(1000)), crc32(new Uint8Array(1000)), 'deterministic');
  assert.notEqual(crc32(bytes('abc')), crc32(bytes('abd')));
});
test('decodeText reads UTF-8, strips a BOM, and understands both UTF-16 byte orders', () => {
  assert.equal(decodeText(bytes('héllo')), 'héllo');
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('ab')])), 'ab', 'UTF-8 BOM');
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00])), 'ab', 'UTF-16 little endian');
  assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62])), 'ab', 'UTF-16 big endian');
  assert.equal(decodeText(new Uint8Array(0)), '');
});
test('decodeText never throws on invalid bytes', () => {
  assert.doesNotThrow(() => decodeText(new Uint8Array([0xff, 0xff, 0xff, 0x80, 0x80])));
  assert.doesNotThrow(() => decodeText(crypto.getRandomValues(new Uint8Array(4_096))));
});
