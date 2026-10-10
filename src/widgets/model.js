export const TYPES = [
  ['clock','Clock','Time, beautifully simple'],['date','Date','Day & date'],['calendar','Calendar','The month at a glance'],
  ['system','System','CPU & memory'],['text','Text','Your own words'],['visualizer','Visualizer','Sound in motion'],
];
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number.isFinite(+v)?+v:a));
export function rect(w){const width=clamp(w.w,.025,1),height=clamp(w.h,.025,1);return{x:clamp(w.x,0,1-width),y:clamp(w.y,0,1-height),w:width,h:height};}
export function createWidget(type,monitor){
  const sizes={clock:[.25,.15],date:[.3,.09],calendar:[.2,.3],system:[.2,.16],text:[.3,.13],visualizer:[.4,.18],rainmeter:[.3,.3]};
  const [w,h]=sizes[type]||sizes.clock;
  return{id:crypto.randomUUID(),type,name:TYPES.find(t=>t[0]===type)?.[1]||'Imported skin',monitor,x:.08,y:.08,w,h,visible:true,locked:false,color:'#f0f3ff',accent:'#59abff',background:false,opacity:100,font:'Segoe UI',fontSize:100,radius:18,text:'Make it yours.',format:'24',seconds:false,date:true,style:'bars',bars:32,sensitivity:100,smoothing:65};
}
function cleanSkin(s){
  if(!s||!Array.isArray(s.meters)||!Array.isArray(s.measures)||!Number.isFinite(s.width)||!Number.isFinite(s.height)||s.width<=0||s.height<=0||s.width>8192||s.height>8192)return null;
  const meters=s.meters.slice(0,128).filter(m=>m&&['string','bar','image'].includes(m.kind)&&['x','y','w','h'].every(k=>Number.isFinite(m[k]))&&m.w>0&&m.h>0).map(m=>({...m,text:String(m.text??'').slice(0,16384),align:String(m.align??'left'),font:String(m.font??'Segoe UI').slice(0,128),fontSize:clamp(m.fontSize??16,4,2048),measures:Array.isArray(m.measures)?m.measures.filter(n=>typeof n==='string').slice(0,16):[],image:typeof m.image==='string'&&/^data:image\/(png|jpeg|webp|bmp|gif);base64,[A-Za-z0-9+/=]+$/.test(m.image)&&m.image.length<=4_194_304?m.image:null}));
  const measures=s.measures.slice(0,512).filter(m=>m&&typeof m.name==='string'&&['time','cpu','memory','uptime','calc','audio','unsupported'].includes(m.kind)).map(m=>({...m,formula:String(m.formula??'0').slice(0,4096),format:String(m.format??'%H:%M').slice(0,256),band:Math.round(clamp(m.band??0,0,31)),max:clamp(m.max??100,0,1e12)}));
  return{...s,meters,measures,warnings:Array.isArray(s.warnings)?s.warnings.slice(0,512).map(v=>String(v).slice(0,512)):[]};
}
export function normalizeWidgets(raw){
  const seen=new Set(),items=[];
  for(const w of (Array.isArray(raw?.items)?raw.items:[]).slice(0,64)){
    if(!w||typeof w.id!=='string'||!w.id||seen.has(w.id)||![...TYPES.map(t=>t[0]),'rainmeter'].includes(w.type))continue;
    const skin=w.type==='rainmeter'?cleanSkin(w.skin):null;if(w.type==='rainmeter'&&!skin)continue;
    seen.add(w.id);items.push({...w,...(skin?{skin}:{}),...rect(w),name:String(w.name??w.type).slice(0,80),text:String(w.text??'').slice(0,1000),radius:clamp(w.radius??18,0,256),opacity:clamp(w.opacity??100,0,100),fontSize:clamp(w.fontSize??100,25,250),bars:clamp(w.bars??32,8,64),sensitivity:clamp(w.sensitivity??100,25,400),smoothing:clamp(w.smoothing??65,0,95),color:/^#[\da-f]{6}$/i.test(w.color)?w.color:'#f0f3ff',accent:/^#[\da-f]{6}$/i.test(w.accent)?w.accent:'#59abff'});
  }
  return{enabled:raw?.enabled!==false,items};
}
export function moveRect(start,dx,dy,mode,screen,snap=false){
  let r={...rect(start)};const minW=Math.min(.1,40/screen.w),minH=Math.min(.1,30/screen.h);
  if(mode==='move') {r.x=clamp(r.x+dx,0,1-r.w);r.y=clamp(r.y+dy,0,1-r.h);if(snap){r.x=Math.round(r.x*screen.w/8)*8/screen.w;r.y=Math.round(r.y*screen.h/8)*8/screen.h;for(const n of [0,(1-r.w)/2,1-r.w])if(Math.abs(r.x-n)*screen.w<8)r.x=n;for(const n of [0,(1-r.h)/2,1-r.h])if(Math.abs(r.y-n)*screen.h<8)r.y=n;}}
  else {if(mode.includes('e'))r.w=clamp(r.w+dx,minW,1-r.x);if(mode.includes('s'))r.h=clamp(r.h+dy,minH,1-r.y);if(mode.includes('w')){const right=r.x+r.w;r.x=clamp(r.x+dx,0,right-minW);r.w=right-r.x;}if(mode.includes('n')){const bottom=r.y+r.h;r.y=clamp(r.y+dy,0,bottom-minH);r.h=bottom-r.y;}}
  return rect(r);
}
export function onMonitor(widget,monitor,monitors){return widget.monitor==='*'||widget.monitor===monitor.key||(!monitors.some(m=>m.key===widget.monitor)&&monitor.primary);}
export function needsMetrics(items){return items.some(w=>w.visible!==false&&(w.type==='system'||w.type==='rainmeter'&&w.skin?.measures?.some(m=>['cpu','memory','uptime'].includes(m.kind))));}
