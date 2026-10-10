import { safePath, decodeText } from './archive.js';
const lower=s=>String(s||'').toLowerCase();
export function arithmetic(input,values={}){
  if(String(input).length>4096)throw Error('Formula exceeds its size limit');
  const src=String(input).replace(/\[([^\]]+)\]/g,'$1');const tokens=src.match(/(?:\d*\.\d+|\d+\.?\d*)|[A-Za-z_][\w]*|[()+\-*/%]/g)||[];
  if(tokens.length>256)throw Error('Formula exceeds its complexity limit');
  if(tokens.join('')!==src.replace(/\s/g,''))throw Error('Unsupported formula');let i=0;
  const primary=()=>{const t=tokens[i++];if(t==='-')return-primary();if(t==='+')return primary();if(t==='('){const n=sum();if(tokens[i++]!==')')throw Error('Unbalanced formula');return n;}if(t===undefined)throw Error('Incomplete formula');if(/^\d|^\./.test(t))return Number(t);if(Object.hasOwn(values,lower(t)))return +values[lower(t)]||0;throw Error('Unknown formula value: '+t);};
  const product=()=>{let n=primary();while(['*','/','%'].includes(tokens[i])){const op=tokens[i++],v=primary();n=op==='*'?n*v:op==='/'?(v?n/v:0):(v?n%v:0);}return n;};
  const sum=()=>{let n=product();while(['+','-'].includes(tokens[i])){const op=tokens[i++],v=product();n=op==='+'?n+v:n-v;}return n;};
  const n=sum();if(i!==tokens.length||!Number.isFinite(n))throw Error('Invalid formula');return n;
}
export function rainColor(value,fallback='#ffffff'){
  if(/^#?[\da-f]{6}([\da-f]{2})?$/i.test(value||''))return'#'+value.replace(/^#/,'');
  const n=String(value||'').split(',').map(Number);if(n.length<3||n.some(x=>!Number.isFinite(x)))return fallback;
  return`rgba(${n.slice(0,3).map(v=>Math.min(255,Math.max(0,v))).join(',')},${Math.min(255,Math.max(0,n[3]??255))/255})`;
}
function dataURL(file){const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp',gif:'image/gif'}[file.name.split('.').pop().toLowerCase()];if(!mime)return null;let s='';for(let i=0;i<file.bytes.length;i+=8192)s+=String.fromCharCode(...file.bytes.subarray(i,i+8192));return`data:${mime};base64,${btoa(s)}`;}
export function compileSkin(packageData,entry){
  const {files}=packageData,warnings=new Set(),sections=new Map(),variables=Object.create(null);let resource='',reads=0,readBytes=0,styleVisits=0;
  const parts=entry.toLowerCase().split('/');for(let i=parts.length-1;i>=0;i--){const prefix=parts.slice(0,i).join('/')+(i?'/':'')+'@resources/';if([...files.keys()].some(n=>n.startsWith(prefix))){resource=prefix;break;}}
  variables['@']=resource;variables.crlf='\n';
  const expand=value=>{let s=String(value??'');for(let i=0;i<8;i++){let length=0;const n=s.replace(/#([^#]+)#/g,(m,k)=>{const value=variables[lower(k)]??m;length+=value.length;if(length>16384)throw Error('Variable expansion exceeds its size limit');return value;});if(n.length>16384)throw Error('Variable expansion exceeds its size limit');if(n===s)break;s=n;}return s;};
  const resolve=(value,from)=>{const expanded=expand(value).replace(/^"|"$/g,'').replace(/\\/g,'/');return safePath((value.includes('#@#')?'':from.slice(0,from.lastIndexOf('/')+1))+expanded).toLowerCase();};
  function read(name,depth=0,chain=[],inherited=null){
    if(depth>8||chain.includes(name)){warnings.add('Recursive or deep @Include omitted');return;}
    const file=files.get(name);if(!file){warnings.add('Missing include: '+name);return;}
    if(++reads>128||(readBytes+=file.bytes.length)>2*1024*1024)throw Error('Include expansion exceeds its size limit');
    let current=inherited;
    for(const line0 of decodeText(file.bytes).split(/\r?\n/)){const line=line0.trim();if(!line||line.startsWith(';'))continue;
      const heading=/^\[([^\]]+)\]$/.exec(line);if(heading){const name=heading[1];current=sections.get(lower(name));if(!current){if(sections.size>=512)throw Error('Skin exceeds 512 sections');current={name,options:Object.create(null),source:file.name.toLowerCase()};sections.set(lower(name),current);}continue;}
      const eq=line.indexOf('=');if(eq<0)continue;const key=lower(line.slice(0,eq).trim()),value=line.slice(eq+1).trim();
      if(key.startsWith('@include')){try{read(resolve(value,name),depth+1,[...chain,name],current);}catch{warnings.add('Include outside package omitted');}continue;}
      if(current){current.options[key]=value;if(lower(current.name)==='variables')variables[key]=value;}
    }
  }
  read(entry.toLowerCase());
  const numeric=(s,fallback=0)=>{try{return arithmetic(expand(s),variables);}catch{if(s!==undefined&&!/^-?[\d.]+[rR]$/.test(s))warnings.add('Unsupported position or formula: '+String(s).slice(0,60));return fallback;}};
  function styled(section,chain=[]){if(++styleVisits>4096)throw Error('MeterStyle expansion exceeds its complexity limit');if(chain.length>8||chain.includes(section.name))return{};let options={};for(const name of (section.options.meterstyle||'').split('|')){const base=sections.get(lower(name.trim()));if(base)Object.assign(options,styled(base,[...chain,section.name]));}return{...options,...section.options};}
  const measures=[];
  for(const s of sections.values())if(s.options.measure){const o=s.options,kind=lower(o.measure);let m={name:lower(s.name),kind,format:expand(o.format||'%H:%M:%S'),max:numeric(o.maxvalue,100),formula:expand(o.formula||'0')};
    if(kind==='physicalmemory'){m.kind='memory';warnings.add(s.name+': physical memory is represented as percentage used');}
    if(kind==='plugin'&&lower(o.plugin).replace(/\.dll$/,'')==='audiolevel'){warnings.add('AudioLevel is mapped to Silk’s 32-band audio spectrum');m.kind='audio';m.band=numeric(o.bandidx,0);m.audioType=lower(o.type||'rms');if(!['rms','peak','band'].includes(m.audioType))warnings.add(s.name+': AudioLevel option approximated');}
    if(!['time','cpu','memory','uptime','calc','audio'].includes(m.kind)){warnings.add(`${s.name}: ${o.measure}${o.plugin?' / '+o.plugin:''} is unsupported`);m.kind='unsupported';}
    if(kind==='cpu'&&numeric(o.processor,0)!==0)warnings.add(s.name+': per-core CPU uses total CPU');
    if(o.substitute||o.regexpsubstitute)warnings.add(s.name+': substitutions are unsupported');
    measures.push(m);
  }
  const meters=[];let previous={x:0,y:0,w:0,h:0},width=1,height=1,minX=0,minY=0,assetBytes=0;
  for(const section of sections.values()){
    const o=styled(section);if(!o.meter)continue;const kind=lower(o.meter);if(!['string','image','bar'].includes(kind)){warnings.add(`${section.name}: ${o.meter} meter is unsupported`);continue;}
    const coord=(v,axis)=>{const m=/^(-?[\d.]+)([rR])$/.exec(expand(v));return m?Number(m[1])+previous[axis]+(m[2]==='R'?previous[axis==='x'?'w':'h']:0):numeric(v,0);};
    const x=coord(o.x,'x'),y=coord(o.y,'y'),fontSize=Math.max(4,numeric(o.fontsize,12)*4/3),text=expand(o.text??(o.measurename?'%1':''));
    const sample=text.replace(/%(\d+)/g,(_,i)=>{const bound=measures.find(m=>m.name===lower(o[+i===1?'measurename':'measurename'+i]));return bound?.kind==='time'?timeFormat(new Date(2030,8,20,22,58,58),bound.format):'100';});
    const m={kind,name:section.name,x,y,w:Math.max(1,numeric(o.w,kind==='string'?Math.max(20,sample.length*fontSize*.7):100)),h:Math.max(1,numeric(o.h,kind==='string'?fontSize*1.5:kind==='image'?100:20)),fontSize,font:expand(o.fontface||'Segoe UI'),color:rainColor(expand(o.fontcolor||o.barcolor||'255,255,255')),background:rainColor(expand(o.solidcolor||'0,0,0,0'),'transparent'),text,align:lower(o.stringalign||'left'),bold:/bold/i.test(o.stringstyle||''),hidden:o.hidden==='1',vertical:lower(o.barorientation)==='vertical',measures:[]};
    for(let i=1;i<=16;i++){const v=o[i===1?'measurename':'measurename'+i];if(v)m.measures.push(lower(v));}
    if(kind==='image'){try{const image=files.get(resolve(o.imagename||'',section.source));if(image){assetBytes+=image.bytes.length;if(assetBytes>3*1024*1024)throw Error('Image assets exceed 3 MB');m.image=dataURL(image);}if(!m.image)warnings.add(section.name+': image missing or unsupported');}catch(e){warnings.add(section.name+': '+e.message);}}
    for(const key of Object.keys(o))if(/action$/.test(key)||/^on.*action/.test(key))warnings.add('Mouse actions, bangs and scripts are not executed');
    if(o.dynamicvariables==='1')warnings.add('Dynamic variables are supported only in text/measure bindings');
    previous=m;const left=m.kind==='string'&&m.align.startsWith('center')?x-m.w/2:m.kind==='string'&&m.align.startsWith('right')?x-m.w:x;minX=Math.min(minX,left);minY=Math.min(minY,y);const right=m.kind==='string'&&m.align.startsWith('center')?x+m.w/2:m.kind==='string'&&m.align.startsWith('right')?x:x+m.w;width=Math.max(width,right);height=Math.max(height,y+m.h);meters.push(m);
    if(meters.length>=128){warnings.add('Only the first 128 supported meters are imported');break;}
  }
  for(const s of sections.values())for(const k of Object.keys(s.options))if(/action$/.test(k))warnings.add('Mouse actions, bangs and scripts are not executed');
  if(packageData.skipped?.length)warnings.add('Bundled DLL, EXE and Lua files are not loaded');
  for(const m of measures)if(m.kind==='calc'){try{arithmetic(m.formula,Object.fromEntries(measures.map(x=>[x.name,0])));}catch{warnings.add(m.name+': formula is unsupported');m.kind='unsupported';}}
  if(!meters.length)throw Error('No supported String, Image or Bar meters found in this skin');
  width-=minX;height-=minY;for(const m of meters){m.x-=minX;m.y-=minY;}
  if(width>8192||height>8192)throw Error('Skin dimensions exceed 8192 pixels');
  return{title:entry.split('/').pop().replace(/\.ini$/i,''),width:Math.max(40,width),height:Math.max(30,height),meters,measures,warnings:[...warnings]};
}
export function timeFormat(date,format){const p=n=>String(n).padStart(2,'0');const codes={H:p(date.getHours()),I:p(date.getHours()%12||12),M:p(date.getMinutes()),S:p(date.getSeconds()),p:date.getHours()<12?'AM':'PM',d:p(date.getDate()),m:p(date.getMonth()+1),Y:String(date.getFullYear()),y:String(date.getFullYear()).slice(-2),A:date.toLocaleDateString(undefined,{weekday:'long'}),a:date.toLocaleDateString(undefined,{weekday:'short'}),B:date.toLocaleDateString(undefined,{month:'long'}),b:date.toLocaleDateString(undefined,{month:'short'}),'%':'%'};return String(format).replace(/%(#?)([%A-Za-z])/g,(m,n,k)=>codes[k]===undefined?m:n?codes[k].replace(/^0/,''):codes[k]);}
export function measureValues(skin,state){const out=Object.create(null);for(const m of skin.measures||[]){let value=0,text='';switch(m.kind){case'time':text=timeFormat(state.now,m.format);value=Number(text)||0;break;case'cpu':value=state.metrics.cpu??0;text=state.metrics.cpu==null?'—':value.toFixed(0);break;case'memory':value=state.metrics.ram??0;text=state.metrics.ram==null?'—':value.toFixed(0);break;case'uptime':value=state.metrics.uptime??0;text=String(Math.floor(value));break;case'audio':value=m.audioType==='band'?(state.bands[m.band]||0):Math.max(0,...state.bands);text=value.toFixed(2);break;case'calc':try{value=arithmetic(m.formula,Object.fromEntries(Object.entries(out).map(([k,v])=>[k,v.value])));}catch{}text=String(Math.round(value*100)/100);break;default:text='—';}out[m.name]={value,text};}return out;}
