const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function harness(enabled=true){
 const model=await import('../src/widgets/model.js'),draw=await import('../src/widgets/draw.js'),resolution=await import('../src/shared/resolution.js');let draws=0,depth=0,width=1000;const listeners={};
 const c=new Proxy({save(){depth++},restore(){depth--},fillText(){draws++},measureText:t=>({width:String(t).length*10}),roundRect:undefined},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 class E{constructor(){this.children=[];this.dataset={};this.style={};this.classList={toggle(){}};}append(...xs){this.children.push(...xs)}replaceChildren(...xs){this.children=xs}setAttribute(){}focus(){}addEventListener(){}querySelector(){return this.children.at(-1)}getBoundingClientRect(){return{width,height:width*9/16,left:0,top:0}}}
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new E());return nodes.get(id)};get('widgetCanvas').getContext=()=>c;let callbacks=[];
 const context={...model,...draw,...resolution,console,crypto:globalThis.crypto,document:{hidden:false,getElementById:get,createElement:()=>new E(),addEventListener(name,fn){listeners[name]=fn},querySelector(){return null},activeElement:null},Option:function(){return new E()},ResizeObserver:class{observe(){}},bridge:{listen(){},invoke:async()=>({})},performance,devicePixelRatio:1.25,setTimeout(){},clearTimeout(){},requestAnimationFrame:fn=>{callbacks.push(fn);return callbacks.length},cancelAnimationFrame(){}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../src/widgets/editor.js'),'utf8').replace(/^import .*$/mg,'').replace('export function widgetEditor','function widgetEditor')+'\nglobalThis.editor=widgetEditor({art(){},notify(){}});',context);
 const w=model.createWidget('clock','A');context.editor.update({widgets:{enabled,items:[w]},assign:{},items:[],display:{},system:{audio:false}},[{key:'A',primary:true,w:1920,h:1080,scale:1.25,name:'A'}]);
 get('sheet').hidden=true;
 return{context,get,c,key(e){listeners.keydown({defaultPrevented:false,preventDefault(){this.defaultPrevented=true},target:{closest:()=>null},...e})},show(){context.editor.activate(true)},frame(){for(const f of callbacks.splice(0))f(1000)},setWidth:n=>width=n,draws:()=>draws,depth:()=>depth};
}
test('editor paints saved widgets even with desktop output disabled',async()=>{const h=await harness(false);h.show();h.frame();assert.ok(h.draws()>0);assert.equal(h.depth(),0);assert.match(h.get('widgetAudioState').textContent,/preview only/)});
test('editor can paint after a hidden tab becomes visible',async()=>{const h=await harness();h.setWidth(0);h.show();h.frame();assert.equal(h.draws(),0);h.setWidth(1000);h.show();h.frame();assert.ok(h.draws()>0);assert.equal(h.depth(),0)});
test('widget drawing restores canvas state after a failed paint',async()=>{const {drawWidget}=await import('../src/widgets/draw.js');let depth=0;const c={save(){depth++},restore(){depth--},beginPath(){},roundRect(){throw Error('lost context')}};assert.throws(()=>drawWidget(c,{type:'clock'},100,100,{}),/lost context/);assert.equal(depth,0)});

test('widget Delete works from layer selection, ignores fields, and supports undo',async()=>{
 const h=await harness();h.show();h.get('widgetLayers').children[0].children[0].onclick();
 h.key({key:'Delete',target:{closest:()=>true}});assert.equal(h.get('widgetLayers').children[0].children.length,4); // name, type icon, visibility, lock
 h.key({key:'Delete'});assert.equal(h.get('widgetLayers').children[0].textContent,'No widgets on this display yet.');
 h.key({key:'z',ctrlKey:true});assert.equal(h.get('widgetLayers').children[0].children.length,4); // name, type icon, visibility, lock
});
