export function keyboard({state,showTab,openSheet,closeSheet,flush,notify}) {
 const $=id=>document.getElementById(id);
 const visible=e=>!!e.getClientRects().length&&!e.disabled;
 $('keyboardShortcuts').onclick=()=>$('keyboardHelp').showModal();
 const fields='input,textarea,select,[contenteditable="true"]';
 document.addEventListener('keydown',async e=>{
  if(e.defaultPrevented)return;
  const st=state(),mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  const modal=document.querySelector('dialog[open]')||(!$('sheet')?.hidden?$('sheet'):null);
  if(mod&&key==='s'){e.preventDefault();try{if(st.tab==='desktops'&&!modal)$('playlistSave').click();else{await flush();notify('Changes saved');}}catch(err){notify(err.message);}return;}
  if(mod&&e.key==='Enter'){if(modal?.id==='sheet'){e.preventDefault();$('sApply').click();}return;}
  if(modal){
   if(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey&&['discoverEmail','discoverCode'].includes(e.target.id)){e.preventDefault();const b=$(e.target.id==='discoverEmail'?'discoverSendCode':'discoverVerify');if(!b.disabled)b.click();return;}
   if(e.key==='Tab'&&modal.id==='sheet'){
    const nodes=[...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(visible);const first=nodes[0],last=nodes.at(-1);
    if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){e.preventDefault();first?.focus();}
   }
   return;
  }
  if(e.target.closest?.(fields))return;
  if(e.altKey&&/^[1-6]$/.test(e.key)){e.preventDefault();const tab=document.querySelectorAll('.dock-item')[Number(e.key)-1];showTab(tab.dataset.tab);tab.focus();return;}
  if(mod&&key==='f'){e.preventDefault();showTab('library');requestAnimationFrame(()=>{$('librarySearch').focus();$('librarySearch').select();});return;}
  if(e.key==='?'){e.preventDefault();$('keyboardHelp').showModal();return;}
  const card=e.target.closest?.('.wcard');
  if(card&&e.key==='F2'){e.preventDefault();if(card.dataset.id)openSheet(card.dataset.id);else card.click();return;}
  const group=e.target.closest?.('.cards,.dock-panel,.seg,.widget-palette');
  if(!group||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  const nodes=[...group.querySelectorAll(group.matches('.cards')?'.wcard':'button')].filter(visible);
  const node=card||e.target.closest('button'),at=nodes.indexOf(node);if(at<0)return;
  let step=1;if(group.matches('.cards')&&['ArrowUp','ArrowDown'].includes(e.key)){const y=nodes[0]?.getBoundingClientRect().top;step=nodes.filter(n=>Math.abs(n.getBoundingClientRect().top-y)<5).length||1;}
  const next=e.key==='Home'?0:e.key==='End'?nodes.length-1:Math.max(0,Math.min(nodes.length-1,at+(['ArrowLeft','ArrowUp'].includes(e.key)?-step:step)));
  e.preventDefault();nodes[next]?.focus();
 });
}
