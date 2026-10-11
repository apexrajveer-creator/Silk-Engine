import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as css from 'css-tree';

const root = process.cwd();
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const files = walk(path.join(root, 'src'));
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    for (const match of text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `Missing import in ${file}: ${match[1]}`);
  }
  if (file.endsWith('.css')) {
    assert.doesNotMatch(text, /export\s+const|window\.__TAURI__/);
    css.parse(text, { positions: true, onParseError: error => { throw error; } });
  }
  if (file.endsWith('.html')) {
    const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, `Duplicate IDs: ${file}`);
    for (const match of text.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^(https?:|data:|blob:)/.test(match[1])) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `Missing asset in ${file}: ${match[1]}`);
    }
  }
}
const pkg = JSON.parse(fs.readFileSync('package.json'));
const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json'));
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
assert.equal(pkg.version, tauri.version);
assert.ok(cargo.includes(`version = "${pkg.version}"`));
assert.ok(fs.existsSync('src-tauri/Cargo.lock'), 'Generate and validate Cargo.lock before packaging');
// Installer branding: Tauri's NSIS/WiX bundlers need BMPs, and a mistake here would only surface at the end
// of a long release build. Check the files up front. The setup wizard (NSIS) draws its bitmaps at a fixed
// pixel size, so those must be exact. The MSI dialogs scale a bitmap to their control, so whole-number
// multiples of the base size with identical proportions are allowed and stay sharp on high-DPI screens.
const win = tauri.bundle.windows ?? {};
const installerImages = [
  [win.nsis?.headerImage, 150, 57, 1], [win.nsis?.sidebarImage, 164, 314, 1],
  [win.wix?.bannerPath, 493, 58, 4], [win.wix?.dialogImagePath, 493, 312, 4],
];
for (const [rel, w, h, maxScale] of installerImages) {
  assert.ok(rel, 'tauri.conf.json is missing an installer image setting');
  const file = path.join('src-tauri', rel);
  assert.ok(fs.existsSync(file), `Installer image not found: ${file}`);
  const bmp = fs.readFileSync(file);
  assert.equal(bmp.toString('latin1', 0, 2), 'BM', `${rel} must be a BMP file`);
  const bw = bmp.readInt32LE(18), bh = Math.abs(bmp.readInt32LE(22)), k = bw / w;
  assert.ok(Number.isInteger(k) && k >= 1 && k <= maxScale && bh === h * k,
    `${rel} must be ${w}x${h}${maxScale > 1 ? ` (or ${maxScale > 2 ? '2x-' + maxScale + 'x' : '2x'} with the same proportions)` : ''}, found ${bw}x${bh}`);
}
assert.ok(win.nsis?.installerIcon && fs.existsSync(path.join('src-tauri', win.nsis.installerIcon)), 'NSIS installer icon is missing');
console.log(`Verified ${files.length} frontend assets, ${installerImages.length} installer images and version ${pkg.version}.`);
