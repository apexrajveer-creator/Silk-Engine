const {test}=require('node:test');const assert=require('node:assert/strict');
test('Profile save/apply restores appearance and keeps additions; manual play stops playlist',async()=>{
 const storage=new Map();global.window={};global.navigator={userAgent:'test'};global.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 global.BroadcastChannel=undefined;
 const {bridge}=await import('../src/shared/bridge.js');
 await bridge.invoke('set_display',{patch:{brightness:70}});
 await bridge.invoke('profile_action',{action:'save',id:'desk',name:'Desk'});
 await bridge.invoke('set_display',{patch:{brightness:130}});
 await bridge.invoke('set_playlist',{playlist:{enabled:true,items:['builtin-silk','builtin-fluid'],interval:300,monitor:'*'}});
 await bridge.invoke('profile_action',{action:'apply',id:'desk',name:''});
 let c=JSON.parse(storage.get('silk-engine-mock'));assert.equal(c.display.brightness,70);assert.equal(c.playlist.enabled,false);assert.equal(c.profiles.length,1);
 await bridge.invoke('set_favorite',{id:'builtin-fluid',favorite:true});await bridge.invoke('set_favorite',{id:'builtin-fluid',favorite:true});
 c=JSON.parse(storage.get('silk-engine-mock'));assert.deepEqual(c.favorites,['builtin-fluid']);
 await bridge.invoke('set_playlist',{playlist:{enabled:true,items:[],interval:300,monitor:'*'}});
 await bridge.invoke('assign',{monitor:'*',itemId:'builtin-fluid'});
 c=JSON.parse(storage.get('silk-engine-mock'));assert.equal(c.playlist.enabled,false);
});
