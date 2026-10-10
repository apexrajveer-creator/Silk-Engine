import { cleanTitle } from '../shared/titles.js';
export function lifestyles({bridge, state, flush, notify, art}) {
  const $=id=>document.getElementById(id);
  let key='', undo=null;
  const run=fn=>async()=>{try{await flush();await fn();}catch(e){notify(e.message||String(e));}};
  const button=(label,fn,cls='btn small tinted',aria)=>{const b=document.createElement('button');b.className=cls;b.type='button';if(label.startsWith('<'))b.innerHTML=label;else b.textContent=label;if(aria){b.setAttribute('aria-label',aria);b.title=aria;}b.onclick=run(fn);return b;};
  const ICON_UPDATE='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',ICON_DELETE='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
  const intervalText={30:'every 30 seconds',60:'every minute',300:'every 5 minutes',900:'every 15 minutes',3600:'every hour',86400:'every day'};
  $('profileForm').onsubmit=e=>{e.preventDefault();saveProfile();};
  const saveProfile=run(async()=>{
    const name=$('profileName').value.trim();if(!name)throw Error('Name your desktop profile');
    await bridge.invoke('profile_action',{action:'save',id:'',name});$('profileName').value='';notify('Desktop profile saved');
  });
  $('profileUndo').onclick=run(async()=>{if(!undo||!confirm('Restore all settings from immediately before the last profile apply?'))return;await bridge.invoke('import_settings',{contents:undo});undo=null;$('profileUndo').hidden=true;notify('Previous desktop restored');});
  $('playlistSave').onclick=run(async()=>{
    const items=[...document.querySelectorAll('#playlistItems input:checked')].map(i=>i.value);
    const enabled=$('playlistEnabled').checked;if(enabled&&items.length<2)throw Error('Select at least two wallpapers');
    await bridge.invoke('set_playlist',{playlist:{items,enabled,interval:Number($('playlistInterval').value),shuffle:$('playlistShuffle').checked,monitor:$('playlistMonitor').value}});notify(enabled?'Playlist started':'Playlist saved and stopped');
  });
  for(const [id,quality,fps] of [['presetQuiet','eco','24'],['presetBalanced','auto','30'],['presetSmooth','high','60'],['presetMax','high','144']])$(id).onclick=run(async()=>{await bridge.invoke('set_display',{patch:{quality,fps}});notify('Performance preset applied');});
  let order=[];
  const count=()=>{const boxes=[...$('playlistItems').querySelectorAll('input')];const on=boxes.filter(b=>b.checked).map(b=>b.value);order=order.filter(v=>on.includes(v));for(const v of on)if(!order.includes(v))order.push(v);
    for(const b of boxes){const n=order.indexOf(b.value);const c=b.closest('.playlist-card');c.dataset.order=n>=0?String(n+1):'';c.querySelector('.pc-tick').textContent=n>=0?String(n+1):'';}
    const n=on.length;$('playlistCount').textContent=n?`${n} selected`:'Choose at least two wallpapers';
    $('playlistSummary').textContent=n>=2?`${n} wallpapers, changing ${intervalText[$('playlistInterval').value]||''}${$('playlistShuffle').checked?' in shuffle order':''}`:'';};
  $('playlistItems').addEventListener('change',count);$('playlistInterval').addEventListener('change',count);$('playlistShuffle').addEventListener('change',count);
  $('playlistAll').onclick=()=>{$('playlistItems').querySelectorAll('input').forEach(i=>i.checked=true);count();};
  $('playlistNone').onclick=()=>{$('playlistItems').querySelectorAll('input').forEach(i=>i.checked=false);count();};
  return {update(){
    const {cfg,monitors}=state();const next=JSON.stringify([cfg.profiles,cfg.playlist,cfg.items.map(i=>[i.id,i.name]),monitors.map(m=>[m.key,m.name])]);
    if(next===key)return;key=next;
    const root=$('profileList');root.replaceChildren();
    for(const p of cfg.profiles||[]){const row=document.createElement('div');row.className='profile-row';
      const mono=document.createElement('span');mono.className='profile-mono';mono.setAttribute('aria-hidden','true');mono.textContent=(p.name.trim()[0]||'?').toUpperCase();
      const info=document.createElement('div');info.className='profile-info';const title=document.createElement('strong');title.textContent=p.name;const meta=document.createElement('small');meta.textContent='Full desktop';info.append(title,meta);
      row.append(mono,info,
      button('Apply',async()=>{undo=await bridge.invoke('export_settings');await bridge.invoke('profile_action',{action:'apply',id:p.id,name:''});$('profileUndo').hidden=false;notify('Profile applied · playlist stopped');},'btn small primary'),
      button(ICON_UPDATE,async()=>{if(confirm('Replace this profile with your current desktop?'))await bridge.invoke('profile_action',{action:'save',id:p.id,name:p.name});},'profile-icon','Update with current desktop'),
      button(ICON_DELETE,async()=>{if(confirm('Delete this saved profile?'))await bridge.invoke('profile_action',{action:'delete',id:p.id,name:''});},'profile-icon danger','Delete profile'));root.append(row);}
    if(!root.children.length){const e=document.createElement('div');e.className='profile-empty';e.innerHTML='<b>No saved desktops yet</b><span>Set things up the way you like, name it above, and switch back any time.</span>';root.append(e);}
    const p=cfg.playlist||{items:[],interval:300,monitor:'*'};
    $('playlistEnabled').checked=!!p.enabled;$('playlistShuffle').checked=!!p.shuffle;$('playlistInterval').value=String(p.interval);
    $('playlistMonitor').replaceChildren(...[['*','All displays'],...monitors.map(m=>[m.key,m.name])].map(([value,name])=>new Option(name,value)));
    if(![...$('playlistMonitor').options].some(o=>o.value===p.monitor))$('playlistMonitor').add(new Option('Disconnected display',p.monitor));
    $('playlistMonitor').value=p.monitor;
    order=(p.items||[]).slice();
    $('playlistItems').replaceChildren(...cfg.items.filter(i=>i.kind!=='skin').map(i=>{const card=document.createElement('label');card.className='playlist-card';
      const input=document.createElement('input');input.type='checkbox';input.value=i.id;input.checked=p.items.includes(i.id);input.setAttribute('aria-label',cleanTitle(i.name));
      const pic=document.createElement('div');pic.className='art pc-art';if(art)art(pic,i);
      const tick=document.createElement('span');tick.className='pc-tick';tick.setAttribute('aria-hidden','true');
      const meta=document.createElement('span');meta.className='pc-meta';const title=document.createElement('strong'),kind=document.createElement('small');title.textContent=cleanTitle(i.name);title.title=i.name;kind.textContent=i.kind==='scene'?'Simulation':i.kind==='video'?'Video':i.kind==='image'?'Image':'Web wallpaper';meta.append(title,kind);
      card.append(input,pic,tick,meta);return card;}));count();
  }};
}
