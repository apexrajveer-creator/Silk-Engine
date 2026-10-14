import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, flush } from './helpers/island-harness.mjs';
const state = (volume=.6) => ({devices:[{id:'speakers',name:'Speakers',default:true},{id:'headphones',name:'Headphones',default:false}],apps:[{deviceId:'speakers',appId:'spotify',name:'Spotify',deviceName:'Speakers',volume,muted:false}]});
async function setup(t) {const h=harness();t.after(()=>h.cleanup());h.answer('mixer_state',state());h.open();await h.advance(100);return h;}
test('mixer only polls while the volume drawer is open and Quick is visible',async t=>{
 const h=await setup(t);assert.equal(h.calls.filter(c=>c.name==='mixer_state').length,0);
 const button=h.node('view-quick').querySelector('.mixer-toggle');button.click();await h.advance(10);
 assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(h.node('audioMixer').inert,false);assert.equal(h.node('view-quick').querySelector('.mixer-app-label span').textContent,'Spotify');
 await h.advance(2010);const count=h.calls.filter(c=>c.name==='mixer_state').length;assert.ok(count>=2);
 button.click();await h.advance(5000);assert.equal(h.calls.filter(c=>c.name==='mixer_state').length,count);assert.equal(h.node('audioMixer').inert,true);
 button.click();await h.advance(10);h.selectTab('system');const stopped=h.calls.filter(c=>c.name==='mixer_state').length;await h.advance(5000);assert.equal(h.calls.filter(c=>c.name==='mixer_state').length,stopped);
});
test('polls retain the app slider and its focus and cannot override a drag',async t=>{
 const h=await setup(t);h.node('view-quick').querySelector('.mixer-toggle').click();await h.advance(10);
 const slider=h.node('view-quick').querySelector('.mixer-app-bar input');slider.focus();slider.dispatch('pointerdown');slider.value=28;slider.dispatch('input');await h.advance(90);
 h.answer('mixer_state',state(.9));await h.advance(2010);assert.equal(h.node('view-quick').querySelector('.mixer-app-bar input'),slider);assert.equal(h.document.activeElement,slider);assert.equal(Number(slider.value),28);
 assert.deepEqual({...h.calls.filter(c=>c.name==='mixer_volume').at(-1).args},{deviceId:'speakers',appId:'spotify',volume:.28});slider.dispatch('pointerup');
});
test('coalesced writes stay ordered and a closed drawer flushes its last edit',async t=>{
 const h=await setup(t);const gate=deferred();h.answer('mixer_volume',()=>gate.promise);const toggle=h.node('view-quick').querySelector('.mixer-toggle');toggle.click();await h.advance(10);
 const slider=h.node('view-quick').querySelector('.mixer-app-bar input');slider.value=20;slider.dispatch('input');await h.advance(80);slider.value=75;slider.dispatch('input');toggle.click();await flush();
 assert.equal(h.calls.filter(c=>c.name==='mixer_volume').length,1);gate.resolve();await flush();assert.deepEqual(h.calls.filter(c=>c.name==='mixer_volume').map(c=>c.args.volume),[.2,.75]);
});
test('disconnected app removal moves focus to the volume icon',async t=>{
 const h=await setup(t);const toggle=h.node('view-quick').querySelector('.mixer-toggle');toggle.click();await h.advance(10);h.node('view-quick').querySelector('.mixer-app-bar input').focus();h.answer('mixer_state',{devices:[],apps:[]});await h.advance(2010);
 assert.equal(h.node('view-quick').querySelector('.mixer-app'),null);assert.equal(h.document.activeElement,toggle);assert.match(h.node('view-quick').querySelector('.mixer-status').textContent,/No audio output/);
});
test('output switching disables repeated requests and updates the confirmed device',async t=>{
 const h=await setup(t);const gate=deferred();h.answer('mixer_output',()=>gate.promise);h.node('view-quick').querySelector('.mixer-toggle').click();await h.advance(10);h.node('view-quick').querySelector('.output-button').click();
 const buttons=h.node('audioOutputs').children;buttons[1].click();buttons[1].click();await flush();assert.equal(h.calls.filter(c=>c.name==='mixer_output').length,1);assert.equal(buttons[1].disabled,true);
 const next=state();next.devices[0].default=false;next.devices[1].default=true;h.answer('mixer_state',next);gate.resolve();await flush();assert.equal(h.node('view-quick').querySelector('.output-button').textContent,'Headphones');assert.equal(h.node('audioOutputs').hidden,true);
});
test('failed volume changes recover the confirmed value and show an error',async t=>{
 const h=await setup(t);h.answer('mixer_volume',()=>{throw Error('App closed');});h.node('view-quick').querySelector('.mixer-toggle').click();await h.advance(10);const slider=h.node('view-quick').querySelector('.mixer-app-bar input');slider.value=25;slider.dispatch('input');await h.advance(90);assert.equal(Number(slider.value),60);
});
test('media artwork opens the displayed native source once; failed focus keeps Island available',async t=>{
 const h=harness();t.after(()=>h.cleanup());h.answer('media_state',{active:true,app:'Spotify',sourceId:'Spotify.exe',thumbId:'track',title:'Track',status:'playing'});const gate=deferred();h.answer('media_open',()=>gate.promise);h.open();await h.advance(100);const art=h.node('view-quick').querySelector('.art');assert.equal(art.disabled,false);art.click();art.click();await flush();
 assert.equal(h.calls.filter(c=>c.name==='media_open').length,1);assert.deepEqual({...h.calls.find(c=>c.name==='media_open').args},{id:'track',sourceId:'Spotify.exe'});gate.reject(Error('Window unavailable'));await flush();assert.equal(h.S.state,'open');assert.equal(art.disabled,false);assert.match(h.node('note').textContent,/Window unavailable/);
});
test('failed device switch leaves the current output and a readable error',async t=>{
 const h=await setup(t);h.answer('mixer_output',()=>{throw Error('Headphones disconnected');});h.node('view-quick').querySelector('.mixer-toggle').click();await h.advance(10);h.node('view-quick').querySelector('.output-button').click();h.node('audioOutputs').children[1].click();await flush();
 assert.equal(h.node('view-quick').querySelector('.output-button').textContent,'Speakers');assert.match(h.node('view-quick').querySelector('.mixer-status').textContent,/Headphones disconnected/);assert.equal(h.node('view-quick').querySelector('.mixer-status').hidden,false);
});
test('a late mixer response cannot populate a closed drawer',async t=>{
 const h=await setup(t);const gate=deferred();h.answer('mixer_state',()=>gate.promise);const toggle=h.node('view-quick').querySelector('.mixer-toggle');toggle.click();await flush();toggle.click();gate.resolve(state());await flush();assert.equal(h.node('view-quick').querySelector('.mixer-app'),null);assert.equal(h.node('audioMixer').inert,true);
});
test('a successful media click hides the Island without toggling the player',async t=>{
 const h=harness();t.after(()=>h.cleanup());h.answer('media_state',{active:true,app:'Spotify',sourceId:'Spotify.exe',thumbId:'track',title:'Track',status:'playing'});h.open();await h.advance(100);h.node('view-quick').querySelector('.art').click();await h.advance(300);assert.equal(h.S.state,'hidden');assert.equal(h.calls.filter(c=>c.name==='media_control').length,0);
});
test('output choices remain intact through collapse and rapid reopen',async t=>{
 const h=await setup(t),view=h.node('view-quick'),toggle=view.querySelector('.mixer-toggle');toggle.click();await h.advance(10);view.querySelector('.output-button').click();assert.equal(h.node('audioOutputs').hidden,false);
 toggle.click();assert.equal(h.node('audioMixer').inert,true);assert.equal(h.node('audioOutputs').hidden,false);await h.advance(100);toggle.click();await h.advance(300);assert.equal(h.node('audioOutputs').hidden,false);assert.equal(h.node('audioMixer').inert,false);
 toggle.click();await h.advance(300);assert.equal(h.node('audioOutputs').hidden,true);
});
