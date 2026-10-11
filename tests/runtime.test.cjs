const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'../src');
function mediaContext(extra={}) {
  const scope = { console, performance: { now:()=>20000 }, clearTimeout(){}, setTimeout(){return 1;}, URL:{revokeObjectURL(){}}, bridge:{mediaURL:async()=>null}, ...extra };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root,'renderer/scenes/media.js'),'utf8').replace(/^import .*$/mg,'').replace('export default class Media','class Media')+'\nglobalThis.Media=Media;',scope);
  return scope;
}
test('repeated unpause does not restart a decoder',()=>{
  const {Media}=mediaContext(); const m=new Media({}, {speed:100}, {},()=>{});let plays=0,pauses=0;
  m.video={play(){plays++;return Promise.resolve()},pause(){pauses++}};
  m.pause(false);m.pause(false);m.pause(false);assert.equal(plays,1);
  m.pause(true);m.pause(true);assert.equal(pauses,1);
});
test('resizing media textures keeps GPU accounting correct',()=>{
  const gl=new Proxy({}, {get:(_,k)=>k==='createTexture'?()=>({}):()=>{}});
  const g={gl,bytes:4};const {Media}=mediaContext();const m=new Media(g,{}, {},()=>{});
  m.upload({},10,10,false);assert.equal(g.bytes,404);
  m.upload({},20,10,false);assert.equal(g.bytes,804);
  m.upload({},20,10,false);assert.equal(g.bytes,804);
  m.unload();assert.equal(g.bytes,4);
});
test('disposed asynchronous media load releases its blob URL',async()=>{
  let resolve,revoked=[];const ctx=mediaContext({bridge:{mediaURL:()=>new Promise(r=>resolve=r)},URL:{revokeObjectURL:u=>revoked.push(u)}});
  const m=new ctx.Media({}, {}, {kind:'video'},()=>{});const pending=m.load();m.unload();resolve('blob:stale');await pending;assert.deepEqual(revoked,['blob:stale']);assert.equal(m.video,undefined);
});
test('decoder recovery retries twice and then reports failure',()=>{
  let now=20000,reloads=0,kicks=0;const {Media}=mediaContext({performance:{now:()=>now}});const m=new Media({}, {}, {},()=>kicks++);
  m.video={paused:false,pause(){}};m.reload=()=>reloads++;
  for(let i=0;i<3;i++){now+=20000;m.health()}
  assert.equal(reloads,2);assert.match(m.error,/stopped responding/);assert.equal(kicks,1);
});
function rendererContext() {
  const noop=()=>{};let requested=0;
  const doc={getElementById:()=>({addEventListener:noop}),querySelectorAll:()=>[],addEventListener:noop};
  const scope={console,document:doc,window:{},performance:{now:()=>100},setInterval:noop,setTimeout:noop,requestAnimationFrame:()=>++requested,cancelAnimationFrame:noop,GL:class {},Silk:class {},Fluid:class {},Lissajous:class {},Particles:class {},Terrain:class {},bridge:{isApp:false},defaults:()=>({fps:'30',quality:'balanced'}),resolved:(_schema,v)=>({fps:'30',quality:'balanced',...v}),DISPLAY:[],location:{search:''}};
  vm.createContext(scope);
  let source=fs.readFileSync(path.join(root,'renderer/main.js'),'utf8').replace(/^import .*$/mg,'');
  source=source.replace(/^boot\(\)\.catch.*$/m,'');
  vm.runInContext(source+'\nglobalThis.api={S,setPaused,kick,frame};',scope);
  return {...scope.api,requested:()=>requested};
}
test('only covered groups pause on a multi-monitor desktop',()=>{
  const {S,setPaused}=rendererContext();const seen=[];
  const a={scene:{pause:p=>seen.push(['a',p])}},b={scene:{pause:p=>seen.push(['b',p])}};
  S.cfg={span:false};S.groups=new Map([['a',a],['b',b]]);S.vis.covered=['A'];S.vps=[{mon:{key:'A'},group:a},{mon:{key:'B'},group:b}];
  setPaused(false);assert.deepEqual(seen,[['a',true],['b',false]]);
});
test('a shared scene stays awake if any assigned display is visible',()=>{
  const {S,setPaused}=rendererContext();let paused;const g={scene:{pause:p=>paused=p}};
  S.cfg={span:false};S.groups=new Map([['shared',g]]);S.vis.covered=['A'];S.vps=[{mon:{key:'A'},group:g},{mon:{key:'B'},group:g}];setPaused(false);assert.equal(paused,false);setPaused(true);assert.equal(paused,true);
});
test('fully covered desktops do not schedule frames',()=>{
  const r=rendererContext();r.S.monitors=[{key:'A'}];r.S.vis.covered=['A'];r.kick();assert.equal(r.requested(),0);
});
test('studio controls have matching HTML targets and no eagle button clutter',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const js=fs.readFileSync(path.join(root,'studio/studio.js'),'utf8');
  for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(!html.includes('heroBird'));assert.ok(html.includes('id="heroToggle"'));assert.ok(!html.includes('How to'));
});
