import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawerMotion } from '../src/island/drawer.js';
function setup() {
 let height=160, reads=0, id=0, collapsed=0, disconnected=false, reduced=false;
 const timers=new Map(),props=new Map(),events=new Map();let resize;
 const root={dataset:{},style:{setProperty:(key,value)=>props.set(key,value)},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const body={getBoundingClientRect(){reads++;return {height};}};
 const motion=createDrawerMotion(root,body,{reduced:()=>reduced,setTimer:(fn)=>{const key=++id;timers.set(key,fn);return key;},clearTimer:key=>timers.delete(key),observe:fn=>{resize=fn;return{observe(){},disconnect(){disconnected=true;}}},onCollapsed:()=>collapsed++});
 return{root,motion,props,timers,get reads(){return reads;},get collapsed(){return collapsed;},get disconnected(){return disconnected;},resize:()=>resize(),height:value=>height=value,reduced:value=>reduced=value,flush(){for(const [key,fn]of [...timers]){timers.delete(key);fn();}},end(){events.get('transitionend')?.({target:root,propertyName:'height'});}};
}
test('drawer targets measured content and coalesces asynchronous size updates',()=>{
 const h=setup();h.motion.setOpen(true);assert.equal(h.props.get('height'),'162px');h.height(220);h.resize();h.resize();h.resize();assert.equal(h.timers.size,1);h.flush();assert.equal(h.props.get('height'),'222px');assert.equal(h.reads,2);h.motion.dispose();
});
test('closing preserves content until the height transition finishes',()=>{
 const h=setup();h.motion.setOpen(true);h.motion.setOpen(false);assert.equal(h.props.get('height'),'0px');assert.equal(h.collapsed,0);h.end();assert.equal(h.collapsed,1);assert.equal(h.timers.size,0);h.motion.dispose();
});
test('rapid reopen cancels stale collapse cleanup',()=>{
 const h=setup();h.motion.setOpen(true);h.motion.setOpen(false);h.motion.setOpen(true);h.flush();h.end();assert.equal(h.collapsed,0);assert.equal(h.root.dataset.open,'true');assert.equal(h.props.get('height'),'162px');h.motion.dispose();
});
test('collapse finishes even when the browser does not send transitionend',()=>{
 const h=setup();h.motion.setOpen(true);h.motion.setOpen(false);h.flush();h.end();assert.equal(h.collapsed,1);h.motion.dispose();
});
test('leaving Quick and reduced motion settle immediately',()=>{
 const h=setup();h.motion.setOpen(true);h.motion.setOpen(false,{immediate:true});assert.equal(h.collapsed,1);assert.equal(h.timers.size,0);h.reduced(true);h.motion.setOpen(true);assert.equal(h.root.dataset.instant,'true');h.motion.setOpen(false);assert.equal(h.collapsed,2);assert.equal(h.timers.size,0);h.motion.dispose();
});
test('closed and disposed drawers schedule no work',()=>{
 const h=setup();h.resize();assert.equal(h.timers.size,0);h.motion.setOpen(true);h.resize();h.motion.dispose();h.flush();assert.equal(h.disconnected,true);h.resize();h.motion.setOpen(true);assert.equal(h.timers.size,0);assert.equal(h.reads,1);
});
test('switching reduced motion during a pending resize snaps to the newest height',()=>{
 const h=setup();h.motion.setOpen(true);h.height(260);h.resize();h.motion.settle();assert.equal(h.props.get('height'),'262px');assert.equal(h.root.dataset.instant,'true');assert.equal(h.timers.size,0);h.motion.dispose();
});
