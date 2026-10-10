const test=require('node:test'),assert=require('node:assert/strict');
test('keyboard shortcuts respect text fields and modal focus, and navigate tabs',async()=>{
 const {keyboard}=await import('../src/studio/keyboard.js');let handler,tab='',saved=0;const sheet={hidden:true};const tabs=Array.from({length:6},(_,i)=>({dataset:{tab:String(i)},focus(){}}));
 global.document={getElementById:id=>id==='sheet'?sheet:{},querySelector:()=>null,querySelectorAll:()=>tabs,addEventListener:(name,fn)=>handler=fn};
 keyboard({state:()=>({tab:'library'}),showTab:v=>tab=v,openSheet(){},flush:async()=>saved++,notify(){}});
 const event=(extra={})=>({key:'2',altKey:true,preventDefault(){this.defaultPrevented=true},target:{closest:()=>null},...extra});
 await handler(event());assert.equal(tab,'1');tab='';
 await handler(event({target:{closest:()=>({})}}));assert.equal(tab,'');
 sheet.hidden=false;await handler(event());assert.equal(tab,'');sheet.hidden=true;
 await handler(event({key:'s',ctrlKey:true,altKey:false}));assert.equal(saved,1);
});
