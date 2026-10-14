import { clamp } from './model.js';
import { measureValues } from './rainmeter.js';
const images=new Map();
function image(src){if(!src?.startsWith('data:image/'))return null;if(images.has(src))return images.get(src);const i=new Image();i.src=src;images.set(src,i);if(images.size>96)images.delete(images.keys().next().value);return i;}
const rounded=(c,x,y,w,h,r)=>{
  r=Math.max(0,Math.min(r,w/2,h/2));c.beginPath();
  if(typeof c.roundRect==='function'){c.roundRect(x,y,w,h,r);return;}
  c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
};
function text(c,t,x,y,size,color,align='left',weight=400,font='Segoe UI'){c.font=`${weight} ${Math.max(4,size)}px "${String(font).replace(/["\\]/g,'')}",system-ui,sans-serif`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';c.fillText(String(t),x,y);}
function fitText(c,t,max,size,font,weight=400){c.font=`${weight} ${size}px "${font}",sans-serif`;return Math.min(size,size*max/Math.max(1,c.measureText(t).width));}
export function drawWidget(c,w,width,height,state){
  c.save();try { c.globalAlpha=clamp((w.opacity??100)/100,0,1);rounded(c,0,0,width,height,w.radius??18);c.clip();
  if(w.background){c.fillStyle='rgba(13,16,24,.68)';c.fillRect(0,0,width,height);c.strokeStyle='rgba(255,255,255,.12)';c.lineWidth=1;rounded(c,.5,.5,width-1,height-1,w.radius??18);c.stroke();}
  const pad=w.background?Math.min(width,height)*.12:4,iw=width-2*pad,ih=height-2*pad,color=w.color||'#fff',accent=w.accent||'#59abff',font=w.font||'Segoe UI',scale=(w.fontSize??100)/100,now=state.now||new Date();
  if(w.type==='clock'){
    const value=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',...(w.seconds?{second:'2-digit'}:{}),hour12:w.format==='12'});
    const size=fitText(c,value,iw,ih*(w.date?.62:.82)*scale,font,300);text(c,value,width/2,pad+ih*(w.date?.39:.5),size,color,'center',300,font);
    if(w.date)text(c,now.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'}),width/2,pad+ih*.83,Math.min(ih*.14*scale,iw/25),accent,'center',500,font);
  }else if(w.type==='date'){
    const value=now.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});text(c,value,width/2,height/2,fitText(c,value,iw,ih*.5*scale,font,500),color,'center',500,font);
  }else if(w.type==='text'){
    const lines=String(w.text||'').split('\n').slice(0,16),size=Math.min(ih/Math.max(lines.length,1)*.7,40*scale*width/400);lines.forEach((line,i)=>text(c,line,pad,pad+ih/2+(i-(lines.length-1)/2)*size*1.35,fitText(c,line,iw,size,font,500),color,'left',500,font));
  }else if(w.type==='calendar'){
    const size=Math.min(iw/9,ih/10)*scale;text(c,now.toLocaleDateString([],{month:'long',year:'numeric'}),pad,pad+ih*.08,size, color,'left',600,font);
    const start=new Date(now.getFullYear(),now.getMonth(),1).getDay(),days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),cellW=iw/7,cellH=ih*.74/6;
    ['S','M','T','W','T','F','S'].forEach((d,i)=>text(c,d,pad+(i+.5)*cellW,pad+ih*.23,size*.62,accent,'center',500,font));
    for(let d=1;d<=days;d++){const i=start+d-1,x=pad+(i%7+.5)*cellW,y=pad+ih*.34+Math.floor(i/7)*cellH;if(d===now.getDate()){c.fillStyle=accent;c.beginPath();c.arc(x,y,Math.min(cellW,cellH)*.42,0,Math.PI*2);c.fill();}text(c,d,x,y,size*.72,d===now.getDate()?'#07101c':color,'center',500,font);}
  }else if(w.type==='system'){
    [['CPU',state.metrics.cpu],['MEMORY',state.metrics.ram]].forEach(([label,value],i)=>{const y=pad+ih*(.12+i*.52);text(c,label,pad,y,ih*.13*scale,accent,'left',600,font);text(c,value==null?'—':Math.round(value)+'%',width-pad,y,ih*.2*scale,color,'right',400,font);c.fillStyle='rgba(255,255,255,.12)';rounded(c,pad,y+ih*.19,iw,Math.max(2,ih*.055),4);c.fill();c.fillStyle=accent;rounded(c,pad,y+ih*.19,iw*clamp(value??0,0,100)/100,Math.max(2,ih*.055),4);c.fill();});
  }else if(w.type==='visualizer'){
    const count=Math.round(clamp(w.bars||32,8,64)),bands=state.bands||[],levels=Array.from({length:count},(_,i)=>clamp((bands[Math.floor(i*bands.length/count)]||0)*(w.sensitivity||100)/100,0,1));
    const gradient=c.createLinearGradient(0,height,width,0);gradient.addColorStop(0,accent);gradient.addColorStop(1,color);c.fillStyle=gradient;c.strokeStyle=gradient;
    if(w.style==='ring'){
      const radius=Math.min(iw,ih)*.25,length=Math.min(iw,ih)*.23;c.lineWidth=Math.max(2,Math.min(iw,ih)/count*.45);c.lineCap='round';levels.forEach((v,i)=>{const a=i/count*Math.PI*2-Math.PI/2;c.beginPath();c.moveTo(width/2+Math.cos(a)*radius,height/2+Math.sin(a)*radius);c.lineTo(width/2+Math.cos(a)*(radius+2+v*length),height/2+Math.sin(a)*(radius+2+v*length));c.stroke();});
    }else if(w.style==='ribbon'){
      c.lineWidth=Math.max(2,ih*.025);c.lineJoin='round';c.beginPath();levels.forEach((v,i)=>{const x=pad+i/(count-1)*iw,y=height/2-v*ih*.42*(i%2?1:-1);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
    }else{const step=iw/count,bw=step*.65;levels.forEach((v,i)=>{const h=Math.max(2,v*ih),y=w.style==='mirror'?height/2-h/2:height-pad-h;rounded(c,pad+i*step,y,bw,h,Math.min(3,bw/2));c.fill();});}
  }else if(w.type==='rainmeter'&&w.skin){
    const skin=w.skin,values=measureValues(skin,state);c.scale(width/skin.width,height/skin.height);
    for(const m of skin.meters){if(m.hidden)continue;c.fillStyle=m.background||'transparent';c.fillRect(m.x,m.y,m.w,m.h);
      if(m.kind==='string'){let value=m.text.replace(/%(\d+)/g,(_,i)=>values[m.measures[+i-1]]?.text??'—').replace(/\[([^\]]+)\]/g,(_,n)=>values[n.toLowerCase()]?.text??'—');const align=m.align.startsWith('center')?'center':m.align.startsWith('right')?'right':'left';text(c,value,m.x,m.y+m.h/2,m.fontSize,m.color,align,m.bold?700:400,m.font);}
      if(m.kind==='image'){const img=image(m.image);if(img?.complete&&img.naturalWidth)c.drawImage(img,m.x,m.y,m.w,m.h);}
      if(m.kind==='bar'){const measure=skin.measures.find(v=>v.name===m.measures[0]);const fraction=clamp((values[m.measures[0]]?.value||0)/(measure?.kind==='audio'?1:measure?.max||100),0,1);c.fillStyle=m.color;m.vertical?c.fillRect(m.x,m.y+m.h*(1-fraction),m.w,m.h*fraction):c.fillRect(m.x,m.y,m.w*fraction,m.h);}
    }
  }
  } finally { c.restore(); }
}
export function smoothBands(previous,next,smoothing=65){const follow=1-clamp(smoothing,0,95)/100;return Array.from({length:32},(_,i)=>{const target=clamp(next[i]||0,0,1),old=Number.isFinite(+previous[i])?+previous[i]:0;return old+(target-old)*(target>old?Math.max(.45,follow):Math.max(.08,follow));});}
