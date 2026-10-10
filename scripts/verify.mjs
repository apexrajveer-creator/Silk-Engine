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
console.log(`Verified ${files.length} frontend assets and version ${pkg.version}.`);
