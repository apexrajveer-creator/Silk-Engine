export function aboutExperience(){
  const page=document.getElementById('about'),bird=document.getElementById('aboutBird'),tilt=document.getElementById('aboutBirdTilt');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let active=false,frame=0,scrollFrame=0,flightTimer=0,x=0,y=0;
  const depth=document.getElementById('aboutBirdDepth'),ghost=page.querySelector('.about-ghost'),stage=document.getElementById('aboutStage');
  const scrollPaint=()=>{scrollFrame=0;if(!active||reduce.matches||document.hidden)return;const r=stage.getBoundingClientRect(),p=Math.max(0,Math.min(1,(80-r.top)/Math.max(1,r.height)));
    depth.style.transform=`translateY(${-p*72}px) rotate(${-p*4}deg) scale(${1-p*.08})`;depth.style.opacity=String(1-p*.35);
    ghost.style.transform=`translateY(${p*65}px) scale(${1+p*.1})`;ghost.style.opacity=String(1-p*.55);
  };
  const scroll=()=>{if(active&&!reduce.matches&&!document.hidden&&!scrollFrame)scrollFrame=requestAnimationFrame(scrollPaint);};
  document.addEventListener('scroll',scroll,{passive:true,capture:true});
  const reset=()=>{cancelAnimationFrame(frame);frame=0;tilt.style.removeProperty('--bird-x');tilt.style.removeProperty('--bird-y');};
  bird.addEventListener('pointermove',e=>{
    if(!active||reduce.matches||e.pointerType==='touch')return;
    const r=bird.getBoundingClientRect();x=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width*2-1));y=Math.max(-1,Math.min(1,(e.clientY-r.top)/r.height*2-1));
    if(!frame)frame=requestAnimationFrame(()=>{frame=0;tilt.style.setProperty('--bird-x',(-y*7)+'deg');tilt.style.setProperty('--bird-y',(x*9)+'deg');});
  });
  bird.addEventListener('pointerleave',reset);bird.addEventListener('blur',reset);
  const fly=()=>{if(!active||reduce.matches||bird.classList.contains('is-flying'))return;bird.classList.add('is-flying');clearTimeout(flightTimer);flightTimer=setTimeout(()=>bird.classList.remove('is-flying'),1150);};
  bird.onclick=fly;
  const stop=()=>{reset();cancelAnimationFrame(scrollFrame);scrollFrame=0;depth.style.removeProperty('transform');depth.style.removeProperty('opacity');ghost.style.removeProperty('transform');ghost.style.removeProperty('opacity');clearTimeout(flightTimer);bird.classList.remove('is-flying');};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else scroll();});
  reduce.addEventListener('change',()=>{if(reduce.matches)stop();else scroll();});
  return {activate(on){active=on;page.classList.toggle('about-enter',on);if(!on)stop();else scroll();}};
}
