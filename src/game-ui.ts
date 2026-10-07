import {visualEffectLabels,type VisualEffect} from './content/visual-effects';
import type {Application} from './application';
import {walkTimings,type WalkTiming} from './core/walk-timing';
import {walkBlendModes,type WalkBlendMode} from './core/walk-blending';
// Animation experiments are developer-preview capabilities, never player UI.
const developerPreview=import.meta.env.MODE==='sandbox';
const walkTrialControls=developerPreview?`<label>Walk smoothing<select id="game-walk-blend"></select></label><p id="walk-blend-help" class="muted"></p><label>Walk stabilization<input id="game-walk-stabilized" type="checkbox" checked></label><label>Rigid sword<input id="game-walk-rigid-sword" type="checkbox" checked></label><label>Walk timing<select id="game-walk-timing"></select></label><p id="walk-timing-help" class="muted"></p>`:'';
export const gameUI=`<main class="stage game-stage"><canvas aria-label="Lantern Knight game" tabindex="0"></canvas>
<div class="title-card"><div class="eyebrow">Lanternkeeper’s Rest</div><h2 id="room-title"></h2></div>
<section class="hud"><div class="row"><span>THE LAMPLIGHTER</span><span id="hp"></span></div><div class="health"><span id="health-fill"></span></div><p id="objective"></p></section>
<div class="actions"><div class="action">Sword<small>LMB</small></div><div class="action">Dodge<small id="dodge-status"></small></div><div class="action">Lantern<small id="ability-status"></small></div></div>
<p class="controls-hint">WASD move · Mouse aim · LMB sword · Shift dodge · RMB lantern · Esc pause</p>
<button id="pause" aria-label="Pause / save">Ⅱ</button><p id="status" role="status"></p>
<section class="modal" id="modal" hidden><div><div class="eyebrow">Lantern Knight</div><h2>Paused</h2><div class="buttons"><button id="resume">Resume</button><button id="reset">Reset encounter</button><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button><button id="new-game">New Game</button></div><p id="save-notice"></p><div id="new-confirm" hidden><p>Replace the saved session with a new game?</p><div class="buttons"><button id="confirm-new">Confirm New Game</button><button id="cancel-new">Cancel</button></div></div>
<label>Camera distance<select id="zoom-span"><option value="9">Close</option><option value="11">Medium</option><option value="13">Wide</option><option value="15">Far</option></select></label>
<label for="depth-of-field">Depth of field <output id="depth-of-field-value">100%</output></label><input id="depth-of-field" type="range" min="0" max="100" step="5" value="100"><p class="muted">Foreground and distance blur. Set to 0% to turn off.</p><label>Render scale<select id="render-scale"><option value="1">100% · up to 4K</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label><fieldset class="visual-options"><legend>Visual effects</legend>${Object.entries(visualEffectLabels).map(([key,label])=>`<label>${label}<input type="checkbox" data-visual-effect="${key}" checked></label>`).join('')}<p class="muted">Rain appears only when the scene or weather calls for it.</p></fieldset>${walkTrialControls}<div id="dev-return"></div></div></section></main>`;
const $=<T extends HTMLElement>(s:string)=>document.querySelector<T>(s)!;
export function bindGameUI(app:Application){
 for(const box of document.querySelectorAll<HTMLInputElement>('[data-visual-effect]')){const key=box.dataset.visualEffect as VisualEffect;box.checked=app.presentation.visualEffects[key];box.onchange=()=>{app.presentation.setVisualEffects({[key]:box.checked});app.safe(()=>app.saveSettings());};}
 if(developerPreview){
 $('#game-walk-blend').innerHTML=Object.entries(walkBlendModes).map(([key,value])=>`<option value="${key}">${value.label}</option>`).join('');
 $<HTMLSelectElement>('#game-walk-blend').value=app.presentation.walkBlend;
 $('#walk-blend-help').textContent=walkBlendModes[app.presentation.walkBlend].description;
 $('#game-walk-blend').onchange=()=>{app.presentation.walkBlend=$<HTMLSelectElement>('#game-walk-blend').value as WalkBlendMode;$('#walk-blend-help').textContent=walkBlendModes[app.presentation.walkBlend].description;};
 $<HTMLInputElement>('#game-walk-stabilized').checked=app.presentation.walkStabilized;
 $('#game-walk-stabilized').onchange=()=>{app.presentation.walkStabilized=$<HTMLInputElement>('#game-walk-stabilized').checked;};
 $('#game-walk-rigid-sword').onchange=()=>{app.presentation.walkRigidSword=$<HTMLInputElement>('#game-walk-rigid-sword').checked;};
 $('#game-walk-timing').innerHTML=Object.entries(walkTimings).map(([key,value])=>`<option value="${key}">${value.label}</option>`).join('');
 $<HTMLSelectElement>('#game-walk-timing').value=app.presentation.walkTiming;
 $('#walk-timing-help').textContent=walkTimings[app.presentation.walkTiming].description;
 $('#game-walk-timing').onchange=()=>{app.presentation.walkTiming=$<HTMLSelectElement>('#game-walk-timing').value as WalkTiming;$('#walk-timing-help').textContent=walkTimings[app.presentation.walkTiming].description;};
 }
 const dof=$<HTMLInputElement>('#depth-of-field'),label=$('#depth-of-field-value');
 const syncDof=()=>{dof.value=String(Math.round(app.presentation.depthOfField*100));label.textContent=app.presentation.depthOfField===0?'Off':dof.value+'%';};syncDof();
 dof.oninput=()=>{app.presentation.setDepthOfField(Number(dof.value)/100);syncDof();};dof.onchange=()=>app.safe(()=>app.saveSettings());
 $('#pause').onclick=()=>app.pause(!app.paused);$('#resume').onclick=()=>app.pause(false);$('#reset').onclick=()=>app.safe(()=>app.reset());
 $('#save').onclick=()=>app.safe(async()=>{status('Saving checkpoint…');await app.save();status('Checkpoint saved');});
 $('#load').onclick=()=>app.safe(async()=>{const r=await app.persistence.load();if(r.status==='ok'||r.status==='recovered'){await app.restore(r.data);status('Checkpoint loaded');}else status(r.status==='unreadable'?r.message:'No saved checkpoint',r.status==='unreadable');});
 $('#new-game').onclick=()=>{$('#new-confirm').hidden=false;};$('#cancel-new').onclick=()=>{$('#new-confirm').hidden=true;};$('#confirm-new').onclick=()=>app.safe(()=>app.newGame());
 $<HTMLSelectElement>('#zoom-span').value=String(app.presentation.verticalSpan);$('#zoom-span').onchange=()=>{app.presentation.verticalSpan=Number($<HTMLSelectElement>('#zoom-span').value);app.presentation.resize(app.scale);app.safe(()=>app.saveSettings());};
 $<HTMLSelectElement>('#render-scale').value=String(app.scale);$('#render-scale').onchange=()=>{app.scale=Number($<HTMLSelectElement>('#render-scale').value);app.presentation.resize(app.scale);app.safe(()=>app.saveSettings());};
 app.events.subscribe(event=>{if(event.kind==='room-clear')status(app.sim.area==='upper-landing'?'The chapel is at rest':'The chapel door is unsealed');});
}
let lastArea='';let statusTimeout:ReturnType<typeof setTimeout>|undefined;
export function status(message:string,error=false){const el=$('#status');el.textContent=message;el.classList.toggle('error',error);clearTimeout(statusTimeout);if(!error)statusTimeout=setTimeout(()=>{el.textContent='';},5000);}
export function showPause(paused:boolean){$('#modal').hidden=!paused;$('#new-confirm').hidden=true;}
export function updateGameUI(app:Application){const s=app.sim;
 $('#hp').textContent=`${s.hero.health} / ${s.hero.definition.maxHealth}`;$('#health-fill').style.width=`${s.hero.health/s.hero.definition.maxHealth*100}%`;
 $('#objective').textContent=s.cleared?(s.area==='court'?'Enter the chapel':'The chapel is at rest'):s.engaged?'Clear the restless dead':s.area==='court'?'Follow the lantern path':'Approach the altar';
 $('#dodge-status').textContent=s.hero.dodgeCooldown?`${(s.hero.dodgeCooldown/60).toFixed(1)} s`:'Shift · ready';$('#ability-status').textContent=s.hero.cooldown?`${(s.hero.cooldown/60).toFixed(1)} s`:'RMB · ready';
 if(lastArea!==s.area){lastArea=s.area;$('#room-title').textContent=s.areaDefinition.name;const title=$('.title-card');title.classList.remove('location-enter');void title.offsetWidth;title.classList.add('location-enter');}
 $<HTMLButtonElement>('#save').disabled=!app.persistence.canWrite||app.busy;$<HTMLButtonElement>('#new-game').disabled=app.persistence.mode==='unreadable'||app.busy;
 $('#save-notice').textContent=app.persistence.error||app.settingsError||(!app.persistence.canWrite?'Existing checkpoint protected. Load it or confirm New Game.':'Manual saves and boundary autosaves share this checkpoint.');
}
