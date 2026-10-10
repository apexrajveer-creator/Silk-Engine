const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../src');

test('Studio loads its layout stylesheet rather than JavaScript content', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
    const css = fs.readFileSync(path.join(root, match[1]), 'utf8');
    assert.doesNotMatch(css, /(?:export\s+const|window\.__TAURI__|function\s+mockConfig)/);
    assert.match(css, /[.#:]\w[^{]*\{[^}]+\}/);
  }
  const css = fs.readFileSync(path.join(root, 'studio/studio.css'), 'utf8');
  for (const selector of [':root', '.page-bg', '.navbar', '.app', '.hero', '.widget-screen']) {
    assert.ok(css.includes(selector + '{') || css.includes(selector + ','), 'Missing layout: ' + selector);
  }
  assert.match(css, /user-select\s*:\s*none/);
  assert.ok(html.includes('href="community/community.css"'));
});
