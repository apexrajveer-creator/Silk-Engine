import { canvasSize } from '../shared/resolution.js';
import { bridge } from '../shared/bridge.js';
import { TYPES,createWidget,normalizeWidgets,rect,moveRect,onMonitor,needsMetrics } from './model.js';
import { drawWidget,smoothBands } from './draw.js';
import { readSkinFiles } from './archive.js';
import { compileSkin } from './rainmeter.js';
const $=id=>document.getElementById(id),clone=v=>JSON.parse(JSON.stringify(v));
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
export function widgetEditor({art,notify}){
  let data=normalizeWidgets(),cfg=null,monitors=[],monitorKey='',selected='',active=false,dirty=false,revision=0,saveTimer,chain=Promise.resolve(),incoming='',backgroundKey='',drag=null;
  let undo=[],redo=[],metrics={cpu:null,ram:null,uptime:0},bands=Array(32).fill(0),target=[],audioAt=0,raf=0,tick=0,lastPaint=0,lastMetrics=0,metricBusy=false,demo=false,pendingImport=null,importTicket=0;
  const selectedWidget=()=>data.items.find(w=>w.id===selected);
  const monitor=()=>monitors.find(m=>m.key===monitorKey)||monitors.find(m=>m.primary)||monitors[0];
  const screen=()=>{const m=monitor();return{w:(m?.w||1920)/(m?.scale||1),h:(m?.h||1080)/(m?.scale||1)};};
  const visible=()=>data.items.filter(w=>onMonitor(w,monitor()||{key:'main',primary:true},monitors));
  function pushHistory(stack,snapshot){stack.push(snapshot);while(stack.length>20||stack.reduce((n,s)=>n+s.length,0)>8e6)stack.shift();}
  function remember(){pushHistory(undo,JSON.stringify(data));redo=[];}
  function queueSave(){dirty=true;revision++;$('widgetSaveState').textContent='Saving…';clearTimeout(saveTimer);saveTimer=setTimeout(save,140);}
  function save(){clearTimeout(saveTimer);if(!dirty)return chain;const payload=clone(data),rev=revision;chain=chain.catch(()=>{}).then(()=>bridge.invoke('set_widgets',{widgets:payload})).then(()=>{if(rev===revision){dirty=false;$('widgetSaveState').textContent='Saved';}}).catch(e=>{$('widgetSaveState').textContent='Retry save';notify('Widget layout could not be saved: '+String(e));});return chain;}
  function change(fn,history=true){if(history)remember();fn();data=normalizeWidgets(data);queueSave();render();}
  function select(id){selected=id;renderList();renderInspector();selection();paintSoon();}
  function add(type){if(data.items.length>=64){notify('A layout can contain up to 64 widgets');return;}change(()=>{const w=createWidget(type,monitor()?.key||'*');const n=visible().length%8;w.x=Math.min(.9-w.w,w.x+n*.05);w.y=Math.min(.9-w.h,w.y+n*.07);data.items.push(w);selected=w.id;});} // cascade so new widgets don't stack on top of each other
  const ICONS={clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',date:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',calendar:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16"/><path d="M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2"/>',system:'<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',text:'<path d="M5 6h14M12 6v13M9 19h6"/>',visualizer:'<path d="M5 15v3M9 9v9M13 5v13M17 11v7M21 14v4"/>',rainmeter:'<path d="M12 3c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10Z"/>'};
  const icon=(type,cls)=>{const s=make('span',(cls||'')+' widget-glyph');s.setAttribute('aria-hidden','true');s.innerHTML='<svg viewBox="0 0 24 24">'+(ICONS[type]||ICONS.rainmeter)+'</svg>';return s;};
  for(const [type,label,desc] of TYPES){const b=make('button','widget-add');const i=make('span','widget-add-icon');i.append(icon(type));const t=make('span','widget-add-text');t.append(make('b',null,label),make('small',null,desc||''));const plus=make('span','widget-add-plus','+');plus.setAttribute('aria-hidden','true');b.append(i,t,plus);b.title='Add '+label;b.setAttribute('aria-label','Add '+label+' widget');b.onclick=()=>add(type);$('widgetPalette').append(b);}
  $('widgetMonitor').onchange=e=>{monitorKey=e.target.value;selected='';backgroundKey='';render();};
  $('widgetsEnabled').onchange=e=>change(()=>data.enabled=e.target.checked);
  $('widgetSaveState').onclick=()=>{if(dirty)save();};
  $('widgetDemo').onclick=()=>{demo=!demo;$('widgetDemo').setAttribute('aria-pressed',String(demo));$('widgetDemo').textContent=demo?'Stop demo':'Test visualizer';paintSoon();};
  const syncSnap=()=>$('widgetScreen')?.classList?.toggle('snapping',!!$('widgetSnap')?.checked);$('widgetSnap')?.addEventListener?.('change',syncSnap);syncSnap();
  $('widgetAudio').onclick=async()=>{await bridge.invoke('set_system',{system:{...cfg.system,audio:!cfg.system.audio}});};
  function history(back){const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;pushHistory(to,JSON.stringify(data));data=normalizeWidgets(JSON.parse(from.pop()));queueSave();render();}
  $('widgetUndo').onclick=()=>history(true);$('widgetRedo').onclick=()=>history(false);
  function renderList(){const list=$('widgetLayers');list.replaceChildren();for(const w of visible().slice().reverse()){
    const row=make('div','widget-layer'+(w.id===selected?' selected':'')+(w.visible===false?' hidden-layer':''));const pick=make('button','widget-layer-name',w.name);pick.onclick=()=>{select(w.id);stage.focus();};pick.title=w.type==='rainmeter'?'Imported Rainmeter skin':w.type;
    const eye=make('button','widget-icon');eye.innerHTML=w.visible===false?'<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2-2.6 3.2M6.6 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1"/></svg>':'<svg viewBox="0 0 24 24"><path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>';eye.title=w.visible===false?'Show widget':'Hide widget';eye.setAttribute('aria-label',eye.title+' '+w.name);eye.onclick=()=>change(()=>w.visible=w.visible===false);
    const lock=make('button','widget-icon'+(w.locked?' on':''));lock.innerHTML=w.locked?'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>':'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/></svg>';lock.title=w.locked?'Unlock position':'Lock position';lock.setAttribute('aria-label',lock.title+' '+w.name);lock.onclick=()=>change(()=>w.locked=!w.locked);
    row.append(pick,icon(w.type,'widget-layer-type'),eye,lock);list.append(row); // icon shown first via CSS order
  }const empty=!list.children.length;if(empty)list.append(make('p','widget-empty','No widgets on this display yet.'));const e=$('widgetStageEmpty');if(e)e.hidden=!empty;}
  function field(label,value,type,onChange,options){const row=make('label','widget-field');row.append(make('span',null,label));let input;
    if(type==='select'){input=make('select');for(const [v,name]of options)input.append(new Option(name,v));input.value=value;}
    else{input=make(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;if(type==='checkbox')input.checked=!!value;else input.value=value??'';}
    input.setAttribute('aria-label',label);input.onchange=()=>{remember();onChange(type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value);data=normalizeWidgets(data);queueSave();render();[...$('widgetInspector').querySelectorAll('input,select,textarea')].find(el=>el.getAttribute('aria-label')===label)?.focus();};
    if(type==='color')input.oninput=()=>{if(!input._recorded){remember();input._recorded=true;}onChange(input.value);queueSave();paintSoon();};
    row.append(input);return row;
  }
  function renderInspector(){const root=$('widgetInspector'),w=selectedWidget();root.replaceChildren();if(!w){root.append(make('p','widget-empty','Select a widget to customise it.'));return;}
    root.append(field('Name',w.name,'text',v=>w.name=String(v).slice(0,80)));
    root.append(field('Display',w.monitor,'select',v=>{w.monitor=v;if(v!=='*')monitorKey=v;},[['*','Every display'],...monitors.map(m=>[m.key,m.name])]));
    const s=screen(),geometry=make('div','widget-geometry');for(const [key,label,axis]of [['x','X','w'],['y','Y','h'],['w','Width','w'],['h','Height','h']]){const row=field(label,Math.round(w[key]*s[axis]),'number',v=>Object.assign(w,rect({...w,[key]:v/s[axis]})));row.querySelector('input').disabled=!!w.locked;geometry.append(row);}root.append(geometry);
    if(w.type!=='rainmeter')root.append(field('Colour',w.color,'color',v=>w.color=v),field('Accent',w.accent,'color',v=>w.accent=v));
    root.append(field('Opacity %',w.opacity,'number',v=>w.opacity=v),field('Glass background',w.background,'checkbox',v=>w.background=v));
    if(w.type!=='rainmeter'&&w.type!=='visualizer')root.append(field('Text size %',w.fontSize,'number',v=>w.fontSize=v),field('Typeface',w.font,'select',v=>w.font=v,[['Segoe UI','Segoe UI'],['Georgia','Georgia'],['Consolas','Consolas'],['Arial','Arial']]));
    if(w.type==='text')root.append(field('Text',w.text,'textarea',v=>w.text=String(v).slice(0,1000)));
    if(w.type==='clock')root.append(field('Time format',w.format,'select',v=>w.format=v,[['24','24-hour'],['12','12-hour']]),field('Seconds',w.seconds,'checkbox',v=>w.seconds=v),field('Date',w.date,'checkbox',v=>w.date=v));
    if(w.type==='visualizer')root.append(field('Style',w.style,'select',v=>w.style=v,[['bars','Bars'],['mirror','Mirrored bars'],['ring','Radial'],['ribbon','Spectrum ribbon']]),field('Bands',w.bars,'number',v=>w.bars=v),field('Sensitivity %',w.sensitivity,'number',v=>w.sensitivity=v),field('Smoothing %',w.smoothing,'number',v=>w.smoothing=v));
    if(w.type==='rainmeter'){const note=make('details','skin-report');note.append(make('summary',null,'Skin compatibility'));for(const msg of w.skin.warnings||[])note.append(make('p',null,msg));if(!w.skin.warnings?.length)note.append(make('p',null,'Supported meters imported.'));root.append(note);}
    const actions=make('div','widget-actions');for(const [label,fn]of [['Duplicate',()=>{if(data.items.length>=64)return;const n=clone(w);n.id=crypto.randomUUID();n.name+=' copy';Object.assign(n,rect({...n,x:n.x+.02,y:n.y+.02}));data.items.push(n);selected=n.id;}],['To front',()=>{data.items=data.items.filter(x=>x.id!==w.id);data.items.push(w);}],['To back',()=>{data.items=data.items.filter(x=>x.id!==w.id);data.items.unshift(w);}],['Remove',()=>{data.items=data.items.filter(x=>x.id!==w.id);selected='';}]]){const b=make('button','btn small tinted',label);b.onclick=()=>change(fn);actions.append(b);}root.append(actions);
  }
  function selection(){const w=selectedWidget(),box=$('widgetSelection');box.hidden=!w||!onMonitor(w,monitor()||{},monitors)||w.visible===false;if(box.hidden)return;Object.assign(box.style,{left:w.x*100+'%',top:w.y*100+'%',width:w.w*100+'%',height:w.h*100+'%'});box.classList.toggle('locked',!!w.locked);}
  function render(){if(!cfg)return;const m=monitor();if(!m)return;monitorKey=m.key;$('widgetsEnabled').checked=data.enabled;$('widgetUndo').disabled=!undo.length;$('widgetRedo').disabled=!redo.length;
    const options=JSON.stringify(monitors.map(m=>[m.key,m.name]));if($('widgetMonitor').dataset.options!==options){$('widgetMonitor').replaceChildren(...monitors.map(m=>new Option(m.name,m.key)));$('widgetMonitor').dataset.options=options;}$('widgetMonitor').value=m.key;
    $('widgetScreen').style.aspectRatio=m.w+'/'+m.h;
    const id=cfg.assign[m.key]||cfg.assign['*'],it=cfg.items.find(i=>i.id===id),key=JSON.stringify([id,it?.settings,cfg.display]);if(key!==backgroundKey){backgroundKey=key;art($('widgetBackdrop'),it);}
    $('widgetAudio').textContent=cfg.system.audio?'System audio on':'Enable system audio';$('widgetAudio').setAttribute('aria-pressed',String(cfg.system.audio));
    renderList();renderInspector();selection();paintSoon();
  }
  function paintSoon(){clearTimeout(tick);if(active&&!raf&&!document.hidden)raf=requestAnimationFrame(paint);}
  function paint(now){raf=0;if(!active||document.hidden)return;const canvas=$('widgetCanvas'),bounds=canvas.getBoundingClientRect(),s=screen();if(!bounds.width||!bounds.height){tick=setTimeout(paintSoon,100);return;}
    const live=now-audioAt<700&&cfg.system.audio&&!cfg.paused;const sample=demo?Array.from({length:32},(_,i)=>(.5+.5*Math.sin(now/400+i*.5))*(.3+.6*Math.abs(Math.sin(now/700+i*.11)))):live?target:[];
    bands=smoothBands(bands,sample,selectedWidget()?.smoothing??65);const moving=demo||(visible().some(w=>w.type==='visualizer'||w.type==='rainmeter'&&w.skin?.measures.some(m=>m.kind==='audio'))&&(live||bands.some(v=>v>.005)));
    if(moving&&now-lastPaint<33){raf=requestAnimationFrame(paint);return;}lastPaint=now;
    const size=canvasSize(bounds.width,bounds.height,devicePixelRatio||1);const cw=size.width,ch=size.height;if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch;}const c=canvas.getContext('2d');if(!c){$('widgetAudioState').textContent='Preview unavailable: canvas context could not be created';tick=setTimeout(paintSoon,1000);return;}c.setTransform(cw/s.w,0,0,ch/s.h,0,0);c.clearRect(0,0,s.w,s.h);
    if(!metricBusy&&now-lastMetrics>2000&&needsMetrics(visible())){lastMetrics=now;metricBusy=true;bridge.invoke('widget_metrics').then(m=>{if(m)metrics=m;}).catch(()=>{}).finally(()=>metricBusy=false);}
    let failure='';
    for(const w of visible()){if(w.visible===false)continue;c.save();try{c.translate(w.x*s.w,w.y*s.h);drawWidget(c,w,w.w*s.w,w.h*s.h,{now:new Date(),bands,metrics});}catch(e){failure=(w.name||w.type)+': '+String(e.message||e);console.error('Widget preview draw failed',w.id,e);}finally{c.restore();}}
    $('widgetAudioState').textContent=failure?'Preview error — '+failure:!data.enabled?'Desktop widgets off · preview only':demo?'Demo audio · preview only':live?'Live system audio':cfg.system.audio?'Waiting for audio':'System audio is off';
    if(moving)raf=requestAnimationFrame(paint);else tick=setTimeout(paintSoon,1000);
  }
  const stage=$('widgetScreen');stage.onpointerdown=e=>{
    if(e.button!==0)return;const bounds=stage.getBoundingClientRect(),x=(e.clientX-bounds.left)/bounds.width,y=(e.clientY-bounds.top)/bounds.height;
    const handle=e.target.dataset.handle;let w=handle?selectedWidget():visible().slice().reverse().find(w=>w.visible!==false&&x>=w.x&&x<=w.x+w.w&&y>=w.y&&y<=w.y+w.h);
    select(w?.id||'');stage.focus();if(!w||w.locked)return;e.preventDefault();stage.setPointerCapture(e.pointerId);drag={id:e.pointerId,start:clone(w),x:e.clientX,y:e.clientY,bounds,mode:handle||'move',before:JSON.stringify(data)};
  };
  stage.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;const w=selectedWidget();if(!w)return;Object.assign(w,moveRect(drag.start,(e.clientX-drag.x)/drag.bounds.width,(e.clientY-drag.y)/drag.bounds.height,drag.mode,screen(),$('widgetSnap').checked&&!e.altKey));selection();paintSoon();};
  const end=(e,cancel)=>{if(!drag||e.pointerId!==drag.id)return;const before=drag.before;if(cancel)data=normalizeWidgets(JSON.parse(before));else if(before!==JSON.stringify(data)){pushHistory(undo,before);redo=[];queueSave();}drag=null;if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);render();};
  stage.onpointerup=e=>end(e,false);stage.onpointercancel=e=>end(e,true);
  document.addEventListener('keydown',e=>{if(!active||e.defaultPrevented||drag||document.querySelector('dialog[open]')||!$('sheet').hidden||e.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();history(false);stage.focus();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){const w=selectedWidget();if(!w)return;e.preventDefault();if(data.items.length>=64)return;change(()=>{const n=clone(w);n.id=crypto.randomUUID();n.name+=' copy';Object.assign(n,rect({...n,x:n.x+.02,y:n.y+.02}));data.items.push(n);selected=n.id;});stage.focus();return;}
if(e.key==='Escape'){selected='';render();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(!e.shiftKey);return;}const w=selectedWidget();if(!w)return;if(e.key==='Delete'){e.preventDefault();change(()=>{data.items=data.items.filter(v=>v.id!==w.id);selected='';});stage.focus();return;}if(w.locked)return;if(!e.target.closest?.('#widgetScreen,#widgetLayers'))return;const n=e.shiftKey?10:1,s=screen(),delta={ArrowLeft:[-n/s.w,0],ArrowRight:[n/s.w,0],ArrowUp:[0,-n/s.h],ArrowDown:[0,n/s.h]}[e.key];if(delta){e.preventDefault();change(()=>Object.assign(w,moveRect(w,...delta,'move',s,false)));stage.focus();}});
  new ResizeObserver(()=>{selection();paintSoon();}).observe(stage);
  bridge.listen('audio',a=>{if(!active)return;target=a.bands||[];audioAt=performance.now();paintSoon();});
  document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);raf=0;clearTimeout(tick);paintSoon();});
  $('widgetCanvas').addEventListener('contextlost',e=>{e.preventDefault();cancelAnimationFrame(raf);raf=0;$('widgetAudioState').textContent='Restoring widget preview…';});
  $('widgetCanvas').addEventListener('contextrestored',()=>{raf=0;paintSoon();});
  async function importFiles(files){const ticket=++importTicket;pendingImport=null;$('skinConfirm').disabled=true;try{$('skinStatus').textContent='Reading skin package…';$('skinImportPanel').hidden=false;const pkg=await readSkinFiles([...files]);if(ticket!==importTicket)return;const entries=[...pkg.files.keys()].filter(n=>/\.ini$/i.test(n)&&!/(^|\/)(rmskin|rainmeter|layout)\.ini$/i.test(n));if(!entries.length)throw Error('No skin INI files found');pendingImport={pkg,entries,skin:null};$('skinEntry').replaceChildren(...entries.map(n=>new Option(n,n)));prepareSkin();}catch(e){if(ticket!==importTicket)return;$('skinStatus').textContent=String(e.message||e);$('skinConfirm').disabled=true;}}
  function prepareSkin(){if(!pendingImport)return;try{const skin=compileSkin(pendingImport.pkg,$('skinEntry').value);pendingImport.skin=skin;const root=$('skinWarnings');root.replaceChildren();for(const msg of skin.warnings)root.append(make('li',null,msg));$('skinStatus').textContent=`${skin.meters.length} meters · ${skin.measures.length} measures${skin.warnings.length?' · Partial compatibility':' · Supported subset'}`;$('skinConfirm').disabled=false;}catch(e){pendingImport.skin=null;$('skinStatus').textContent=String(e.message||e);$('skinWarnings').replaceChildren();$('skinConfirm').disabled=true;}}
  $('skinEntry').onchange=prepareSkin;
  $('skinFile').onchange=e=>{if(e.target.files.length)importFiles(e.target.files);e.target.value='';};$('skinFolder').onchange=e=>{if(e.target.files.length)importFiles(e.target.files);e.target.value='';};
  $('skinImport').onclick=()=>$('skinFile').click();$('skinImportFolder').onclick=()=>$('skinFolder').click();$('skinCancel').onclick=()=>{importTicket++;$('skinImportPanel').hidden=true;pendingImport=null;};
  $('skinConfirm').onclick=()=>{const skin=pendingImport?.skin;if(!skin)return;if(data.items.length>=64){notify('The layout already contains 64 widgets');return;}change(()=>{const w=createWidget('rainmeter',monitor()?.key||'*'),s=screen();w.name=skin.title;w.skin=skin;const k=Math.min(1,s.w*.8/skin.width,s.h*.8/skin.height);w.w=skin.width*k/s.w;w.h=skin.height*k/s.h;data.items.push(w);selected=w.id;});$('skinImportPanel').hidden=true;pendingImport=null;};
  return{update(config,ms){cfg=config;monitors=ms;const key=JSON.stringify(config.widgets||{});if(!dirty&&!drag&&key!==incoming){data=normalizeWidgets(config.widgets);incoming=key;if(!data.items.some(w=>w.id===selected))selected='';if(active)render();}else if(active&&!drag&&!document.activeElement?.closest('#widgetInspector'))render();},activate(on){active=on;if(on){cancelAnimationFrame(raf);raf=0;render();paintSoon();}else{demo=false;$('widgetDemo').textContent='Test visualizer';$('widgetDemo').setAttribute('aria-pressed','false');clearTimeout(tick);cancelAnimationFrame(raf);raf=0;if(dirty)save();}},async flush(){await save();if(dirty)throw Error('Widget changes are not saved. Retry save before closing.');}};
}
