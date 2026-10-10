// Native scrolling stays on Chromium's compositor. Never cancel or synthesize wheel input.
let busy=false, timer=0;
export const navigationBusy=()=>busy;
export function waitForNavigationIdle(){
  if(!busy)return Promise.resolve();
  return new Promise(resolve=>document.addEventListener('studio-navigation-idle',resolve,{once:true}));
}
export function installScrolling(){
  const idle=()=>{clearTimeout(timer);if(!busy)return;busy=false;document.documentElement.classList.remove('navigating');document.dispatchEvent(new Event('studio-navigation-idle'));};
  const activity=()=>{
    if(!busy){busy=true;document.documentElement.classList.add('navigating');document.dispatchEvent(new Event('studio-navigation-start'));}
    clearTimeout(timer);timer=setTimeout(idle,180);
  };
  document.addEventListener('wheel',activity,{passive:true,capture:true});
  document.addEventListener('scroll',activity,{passive:true,capture:true});
  document.addEventListener('touchmove',activity,{passive:true,capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)idle();});
  return activity;
}
