import { widgetPolicy } from '../shared/widget-policy.js';
import { canvasSize } from '../shared/resolution.js';
import { bridge } from '../shared/bridge.js';
import { normalizeWidgets,onMonitor,needsMetrics } from './model.js';
import { drawWidget,smoothBands } from './draw.js';
const root=document.getElementById('widgetLayer');
let cfg=null,monitors=[],vis={covered:[]},nodes=[],bands=Array(32).fill(0),target=Array(32).fill(0),metrics={cpu:null,ram:null,uptime:0},audioAt=0,raf=0,timer=0,metricAt=0,last=0,busyMetrics=false;
function sync(){
  if(!cfg)return;clearTimeout(timer);cancelAnimationFrame(raf);raf=0;const data=normalizeWidgets(cfg.widgets);for(const n of nodes)n.canvas.width=n.canvas.height=1;root.replaceChildren();nodes=[];
  if(!data.enabled||widgetPolicy(cfg,vis).hidden)return;
  const dpr=devicePixelRatio||1;
  let area=0;for(const m of monitors)if(!vis.covered?.includes(m.key))for(const w of data.items)if(w.visible!==false&&onMonitor(w,m,monitors))area+=m.w*m.h*w.w*w.h;
  const budgetScale=Math.min(1,Math.sqrt(16_777_216/Math.max(1,area)));
  for(const monitor of monitors){if(vis.covered?.includes(monitor.key))continue;
    for(const w of data.items){if(w.visible===false||!onMonitor(w,monitor,monitors))continue;const el=document.createElement('canvas');const width=Math.max(1,monitor.w/dpr*w.w),height=Math.max(1,monitor.h/dpr*w.h);const size=canvasSize(width,height,dpr*budgetScale,4_194_304);el.width=size.width;el.height=size.height;Object.assign(el.style,{position:'fixed',left:(monitor.x/dpr+w.x*monitor.w/dpr)+'px',top:(monitor.y/dpr+w.y*monitor.h/dpr)+'px',width:width+'px',height:height+'px'});el.addEventListener('contextrestored',sync,{once:true});root.append(el);nodes.push({w,canvas:el,c:el.getContext('2d'),width,height,ratio:el.width/width,ratioY:el.height/height,bands:Array(32).fill(0)});}
  }kick();
}
function kick(){clearTimeout(timer);if(!raf&&nodes.length&&!vis.hibernating)raf=requestAnimationFrame(paint);}
function paint(now){
  raf=0;const policy=widgetPolicy(cfg,vis);if(!nodes.length||policy.hidden)return;
  const audible=cfg.system.audio&&!policy.paused&&now-audioAt<700;const moving=nodes.some(n=>n.w.type==='visualizer'||n.w.type==='rainmeter'&&n.w.skin.measures.some(m=>m.kind==='audio'));
  bands=smoothBands(bands,audible?target:[],65);
  const active=moving&&(audible||bands.some(v=>v>.005));
  if(active&&now-last<1000/policy.fps-1){raf=requestAnimationFrame(paint);return;}last=now;
  if(!busyMetrics&&now-metricAt>2000&&needsMetrics(nodes.map(n=>n.w))){busyMetrics=true;metricAt=now;bridge.invoke('widget_metrics').then(m=>{if(m)metrics=m;}).catch(()=>{}).finally(()=>busyMetrics=false);}
  const nowDate=new Date();const shift=Math.floor(nowDate.getTime()/120000);root.style.transform=cfg.display?.burnGuard?`translate(${Math.round(Math.sin(shift*1.7)*4)}px,${Math.round(Math.cos(shift*1.3)*4)}px)`:'';
  const state={now:nowDate,metrics,bands};
  for(const n of nodes){if(!n.c)continue;n.c.setTransform(n.ratio,0,0,n.ratioY,0,0);n.bands=smoothBands(n.bands,audible?target:[],n.w.smoothing);n.c.clearRect(0,0,n.width,n.height);try{drawWidget(n.c,n.w,n.width,n.height,{...state,bands:n.bands});}catch(e){if(!n.failed)console.error('Desktop widget draw failed',n.w.id,e);n.failed=true;}}
  if(active)raf=requestAnimationFrame(paint);else timer=setTimeout(kick,1000);
}
bridge.invoke('get_state').then(s=>{cfg=s.config;monitors=s.monitors;vis=s.visibility||vis;sync();});
let lastConfig='';bridge.listen('state',c=>{const key=JSON.stringify(c.widgets);cfg=c;if(key!==lastConfig){lastConfig=key;sync();}else kick();});
bridge.listen('layout',m=>{monitors=m;sync();});bridge.listen('visibility',v=>{vis=v;sync();});
bridge.listen('audio',a=>{target=a.bands||[];audioAt=performance.now();if(nodes.some(n=>n.w.type==='visualizer'||n.w.type==='rainmeter'))kick();});
addEventListener('resize',sync);
