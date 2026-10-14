// Execute the actual browser handoff script with an in-memory selection and no network/navigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../src/search/handoff.html', import.meta.url), 'utf8');
const script = /<script nonce="silk">([\s\S]+?)<\/script>/.exec(html)[1];
async function run(options = {}) {
  const elements = Object.fromEntries(['status', 'form', 'file', 'retry', 'alternate', 'preview', 'download'].map(id => [id, { disabled: true, hidden: true }]));
  const requests = [], uploads = [];
  elements.form.submit = () => uploads.push({ action: elements.form.action, file: elements.file.files[0] });
  const crop = new Blob(['selected pixels only'], { type: 'image/png' });
  class Transfer { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } }
  const scope = { Blob, File, URL: { createObjectURL: () => 'blob:selected-only' }, DataTransfer: options.unsupported ? undefined : Transfer,
    document: { getElementById: id => elements[id] },
    fetch: async (...args) => { requests.push(args); if (options.expired) return { ok: false }; return { ok: true, blob: async () => crop }; },
  };
  vm.createContext(scope); await vm.runInContext(script, scope);
  return { elements, uploads, requests, crop };
}
test('Lens handoff submits only the selected PNG file via browser navigation', async () => {
  const r = await run(); assert.equal(r.requests.length, 1); assert.equal(r.requests[0][0], 'image.png'); assert.equal(r.requests[0][1].credentials, 'omit');
  assert.equal(r.uploads.length, 1); assert.equal(r.uploads[0].action, 'https://lens.google.com/upload');
  assert.equal(r.uploads[0].file.name, 'silk-selection.png'); assert.equal(r.uploads[0].file.type, 'image/png'); assert.equal(await r.uploads[0].file.text(), await r.crop.text());
});
test('retry reuses the exact same crop without another capture or fetch', async () => {
  const r = await run(); r.elements.retry.onclick(); assert.equal(r.requests.length, 1);
  assert.equal(r.uploads[1].file, r.uploads[0].file);
});
test('expired local selection is not uploaded and gives a useful recovery message', async () => {
  const r = await run({ expired: true }); assert.equal(r.uploads.length, 0); assert.match(r.elements.status.textContent, /expired/);
});
test('a browser without programmatic file-input support retains a save fallback', async () => {
  const r = await run({ unsupported: true }); assert.equal(r.uploads.length, 0); assert.equal(r.elements.download.hidden, false); assert.equal(r.elements.download.href, 'blob:selected-only');
});
