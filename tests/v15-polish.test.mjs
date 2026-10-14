import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { harness } from './helpers/island-harness.mjs';
import { SYSTEM, defaults } from '../src/shared/catalog.js';
test('Island transparency has a compatible default and responds to live state on every tab', async t => {
 const h=harness();t.after(()=>h.cleanup());h.open();await h.advance(100);h.selectTab('system');
 assert.equal(defaults(SYSTEM).islandTransparency,12);
 h.emit('state',{...h.config,system:{islandTransparency:60}});
 assert.equal(h.document.documentElement.style.getPropertyValue('--island-opacity'),'0.4');
 h.emit('state',{...h.config,system:{islandTransparency:999}});
 assert.ok(Math.abs(Number(h.document.documentElement.style.getPropertyValue('--island-opacity'))-.2)<1e-9);
 h.emit('state',{...h.config,system:{}});assert.equal(h.document.documentElement.style.getPropertyValue('--island-opacity'),'0.88');
});
test('the actual transparency reset updates the slider, visible value and persistence callback', () => {
 const h=harness();const source=fs.readFileSync(new URL('../src/studio/studio.js',import.meta.url),'utf8');
 const start=source.indexOf('function control('),end=source.indexOf('/** A glass group',start),changes=[];
 const make=(tag,cls,text)=>{const n=h.document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const scope={el:make,esc:String};vm.createContext(scope);vm.runInContext(source.slice(start,end)+'\nglobalThis.create=control;',scope);
 const schema=SYSTEM.find(s=>s.key==='islandTransparency'),row=scope.create(schema,50,v=>changes.push(v));
 row.querySelector('.transparency-reset').onclick();assert.equal(row.querySelector('input').value,12);assert.deepEqual(changes,[12]);assert.equal(row.querySelector('.trail').textContent,'12%');h.cleanup();
});
