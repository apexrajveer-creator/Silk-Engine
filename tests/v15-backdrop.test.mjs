import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('Studio backdrop sleeps between frames, stops when hidden/reduced, and releases its context', () => {
  let time=0,id=0,draws=0,lost=false,tint=[];const timers=new Map(),events=new Map(),reduce={matches:false,addEventListener(_,fn){this.change=fn;}};
  const set=(fn,delay=0)=>{const key=++id;timers.set(key,{fn,at:time+delay});return key;},clear=key=>timers.delete(key);
  const tick=ms=>{const end=time+ms;for(let i=0;i<1000;i++){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [key,t]=next;timers.delete(key);time=t.at;t.fn(time);}time=end;};
  const listen=(name,fn)=>{const handlers=events.get(name)||[];handlers.push(fn);events.set(name,handlers);},fire=name=>{for(const fn of events.get(name)||[])fn();};
  const gl=new Proxy({}, { get:(_,key)=>key==='getProgramParameter'?()=>true:key==='getAttribLocation'?()=>0:key==='uniform3f'?(_,r,g,b)=>{tint=[r,g,b];}:key==='drawArrays'?()=>draws++:key==='getExtension'?()=>({loseContext(){lost=true;}}):()=>({}) });
  const document={hidden:false,hasFocus:()=>true,addEventListener:listen};
  const scope={document,navigator:{hardwareConcurrency:8,deviceMemory:8},matchMedia:()=>reduce,performance:{now:()=>time},innerWidth:1280,innerHeight:820,navigationBusy:()=>false,
    requestAnimationFrame:fn=>set(fn,16),cancelAnimationFrame:clear,setTimeout:set,clearTimeout:clear,addEventListener:listen,Float32Array};
  vm.createContext(scope);vm.runInContext(fs.readFileSync(new URL('../src/studio/backdrop.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function backdrop','function backdrop')+'\nglobalThis.start=backdrop;',scope);
  const surface=scope.start({width:0,height:0,style:{},getContext:()=>gl});assert.equal(draws,1);tick(250);assert.ok(draws>=6&&draws<=10);surface.setAccent('#ff0000');tick(240);assert.ok(tint[0]>tint[1]&&tint[0]>tint[2]);
  document.hidden=true;fire('visibilitychange');assert.equal(timers.size,0);const before=draws;tick(1000);assert.equal(draws,before);
  document.hidden=false;fire('visibilitychange');reduce.matches=true;reduce.change();assert.equal(timers.size,0);
  reduce.matches=false;reduce.change();assert.equal(timers.size,1);fire('pagehide');assert.equal(timers.size,0);assert.equal(lost,true);
});
