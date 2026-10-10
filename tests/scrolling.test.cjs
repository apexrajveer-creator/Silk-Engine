const {test}=require('node:test'),assert=require('node:assert/strict');
test('navigation tracking never cancels wheel input and releases deferred work',async()=>{
 const listeners={},classes=new Set();global.document={hidden:false,documentElement:{classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}},addEventListener(name,fn,options){(listeners[name]||=[]).push({fn,options})},dispatchEvent(e){const list=listeners[e.type]||[];listeners[e.type]=list.filter(x=>!x.options?.once);list.forEach(x=>x.fn(e));}};
 const {installScrolling,navigationBusy,waitForNavigationIdle}=await import('../src/studio/scrolling.js');installScrolling();
 assert.equal(listeners.wheel[0].options.passive,true);listeners.wheel[0].fn({preventDefault(){throw Error('wheel cancelled')}});
 assert.equal(navigationBusy(),true);let done=false;const p=waitForNavigationIdle().then(()=>done=true);assert.equal(done,false);
 document.hidden=true;listeners.visibilitychange[0].fn();await p;assert.equal(navigationBusy(),false);assert.equal(classes.has('navigating'),false);
});
