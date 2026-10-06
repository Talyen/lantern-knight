import './style.css';
import {AssetLoader} from './assets/loader';
import {Presentation,type Mode} from './presentation/scene';
import {Simulation,FixedClock,type Command} from './core/simulation';
import {Input} from './core/input';
import {HEADINGS,calibrationFixture,contract} from './core/camera';
import {clipDuration} from './core/animation';
import {tuning} from './content/gameplay';
import {browserBridge,type GameSave} from './core/save';
const $=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
$('#app').innerHTML=`<header><div><h1>LANTERN KNIGHT</h1><small>Foundation / 001</small></div><span class="badge">PROXY ART · APPROVAL PENDING</span><nav aria-label="Rooms"><button data-mode="encounter" class="active">Encounter</button><button data-mode="calibration">Calibration</button><button data-mode="animation">Animation lab</button><button data-mode="occlusion">Occlusion</button></nav></header><main class="stage"><canvas aria-label="Lantern Knight game" tabindex="0"></canvas><div class="title-card"><div class="eyebrow" id="room-eyebrow">A small playable encounter</div><h2 id="room-title">The Lamplighter’s Court</h2><p id="room-subtitle">Three wardens. One light. Keep moving.</p></div><section class="panel" id="lab" hidden><h3>Animation laboratory</h3><label>Clip<select id="clip"></select></label><label>World heading<select id="heading"></select></label><div class="buttons"><button id="play">Pause</button><button id="step">Step frame</button></div><label>Speed<select id="speed"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label><label for="scrub">Visual timeline <span id="visual-time"></span></label><input id="scrub" type="range" min="0" max="800" value="0" step="1"><p class="muted">Seeking is silent. Damage is simulation-owned.</p><label>Anchor / trim / sockets<input id="overlays" type="checkbox" checked></label><label>Backdrop<select id="background"><option value="dark">Dark</option><option value="light">Light</option></select></label><p class="eyebrow">Sword authority / 60 Hz</p><div class="timeline"></div><p class="muted">Wind-up 0–166 ms · active 167–249 ms · recovery to 600 ms</p><p id="frame-status" class="muted"></p><div id="notify" class="log"></div></section><section class="panel" id="calibration" hidden><h3>Camera &amp; asset space</h3><p class="muted">${contract.id}<br>PROVISIONAL · 45° azimuth / 35.264° elevation</p><p>XZ ground · +Y height<br>12-unit vertical span · 1.8-unit hero</p><div class="directions">${calibrationFixture().headings.map(h=>`<span>${h.id} ${h.facing==='toward camera'?'↓ FRONT':h.facing==='away from camera'?'↑ BACK':h.screenVector[0]!>.1?'→':h.screenVector[0]!<-.1?'←':h.screenVector[1]!>0?'↓':'↑'}</span>`).join('')}</div><p class="muted">W → (−X, −Z) · D → (+X, −Z)<br>Travel faces movement; idle faces aim.</p><label>Foot/canvas/trim<input id="calibration-debug" type="checkbox"></label><label>Backdrop<select id="calibration-background"><option value="dark">Dark</option><option value="light">Light</option></select></label><div class="swatches"><span style="background:#808080"></span><span style="background:#e9bc67"></span><span style="background:#263b4a"></span></div><p class="muted">Reference sRGB swatches appear in the scene.</p></section><section class="panel" id="occlusion" hidden><h3>Composition proof</h3><p>Walk around the pillar, tree, corner and foreground crown.</p><p class="muted">Opaque geometry + alpha cutout actors. Contact shadows and translucent effects keep depth testing.</p><label>Collision / foot markers<input id="collision" type="checkbox" checked></label><div class="buttons"><button id="occlude-front">In front</button><button id="occlude-back">Behind</button></div><p class="muted">Nearby obstructing geometry fades to 38%. Collision is unchanged. General bridges and overhangs are outside this foundation.</p></section><section class="hud"><div class="row"><span>THE LANTERN KNIGHT</span><span id="hp">100 / 100</span></div><div class="health"><span id="health-fill"></span></div><div class="row"><span id="enemy-count">3 wardens remain</span><span id="state">idle</span></div></section><div class="actions"><div class="action">Sword<small>LMB · 0.6 s commitment</small></div><div class="action">Dodge<small id="dodge-status">Shift · ready</small></div><div class="action">Lantern flare<small id="ability-status">RMB · ready</small></div></div><section class="modal" id="modal" hidden><div><div class="eyebrow">Lantern Knight / Foundation</div><h2 id="modal-title">Paused</h2><p id="modal-copy">The court can wait.</p><div class="buttons"><button id="resume">Resume</button><button id="reset">Reset room</button><button id="save">Save checkpoint</button><button id="load">Load checkpoint</button></div><label>Render scale <select id="render-scale"><option value="1">100% · DPR capped at 1</option><option value=".75">75%</option><option value=".5">50%</option></select></label></div></section></main><footer><span>WASD move · mouse aim · LMB sword · Shift dodge · RMB flare · Esc pause</span><button id="pause">Pause / save</button><span class="status" id="status" role="status">Loading manifest…</span></footer>`;
let sim=new Simulation(),presentation:Presentation,input:Input,paused=false,mode:Mode='encounter',scale=1,wins=0,ready=false;const clock=new FixedClock(),bridge=window.lantern??browserBridge;
let roomAbort=new AbortController(),roomRelease:(()=>void)|undefined,heroRelease:(()=>void)|undefined,loader:AssetLoader;
let last=performance.now(),aim={x:0,z:1},benchmark=false,benchmarkFrames:number[]=[];
let benchmarkCommand:Command|undefined;
const status=(text:string)=>{$('#status').textContent=text;};
function pause(value:boolean){paused=value;clock.reset();input?.clear();$('#modal').hidden=!value;$('#modal-title').textContent=sim.hero.health<=0?'The light went out':sim.cleared?'The court is quiet':'Paused';$('#modal-copy').textContent=sim.hero.health<=0?'Reset the room and try again.':sim.cleared?'All three wardens have fallen. Save this checkpoint or return to the court.':'The court can wait.';}
async function loadRoom(){const controller=new AbortController();roomAbort.abort();roomAbort=controller;const old=roomRelease;roomRelease=undefined;old?.();
  const lease=await loader.load('room',controller.signal,(done,total)=>status(`Loading room ${done}/${total}`));
  if(controller!==roomAbort){lease.release();return;}roomRelease=lease.release;presentation.resetRoom();sim=new Simulation();clock.reset();input.clear();pause(false);status('Room ready · proxy content');
}
function setMode(next:Mode){mode=next;presentation.setMode(next);clock.reset();input.clear();pause(false);presentation.debug=next==='animation'||next==='occlusion';
  for(const el of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))el.classList.toggle('active',el.dataset.mode===next);
  $('#lab').hidden=next!=='animation';$('#calibration').hidden=next!=='calibration';$('#occlusion').hidden=next!=='occlusion';$('.hud').hidden=next==='animation'||next==='calibration';$('.actions').hidden=$('.hud').hidden;
  $('#room-title').textContent=next==='animation'?'From source to motion':next==='calibration'?'A shared frame of reference':next==='occlusion'?'Grounded in the world':'The Lamplighter’s Court';
  $('#room-eyebrow').textContent=next==='encounter'?'A small playable encounter':'Foundation / inspection';$('#room-subtitle').textContent=next==='encounter'?'Three wardens. One light. Keep moving.':next==='animation'?'Same animator. Same atlas. Independent actors.':'PROVISIONAL camera v1 · diagnostic / proxy assets';
}
function saveValue():GameSave{return{version:1,seed:142,wins,hero:{x:sim.hero.x,z:sim.hero.z,health:sim.hero.health},enemies:sim.actors.slice(1,4).map(a=>({x:a.x,z:a.z,health:a.health}))};}
function restore(save:GameSave){sim=new Simulation(save.seed);wins=save.wins;for(let i=0;i<4;i++){const state=i===0?save.hero:save.enemies[i-1]!,a=sim.actors[i]!;Object.assign(a,state);a.px=a.x;a.pz=a.z;sim.start(a,a.health>0?'idle':'death');}sim.cleared=sim.actors.slice(1).every(a=>a.health<=0);clock.reset();}
const safe=(fn:()=>Promise<void>)=>void fn().catch(e=>status(String(e.message??e)));
async function boot(){
  loader=await AssetLoader.open();const hero=await loader.load('hero',undefined,(done,total)=>status(`Decoding hero ${done}/${total}`));heroRelease=hero.release;
  presentation=new Presentation($('canvas'),loader.manifest,hero.resources);
  input=new Input($('canvas'),presentation.camera,()=>pause(!paused));
  const settings=await bridge.loadSettings();if(settings.status==='ok'||settings.status==='recovered'){scale=settings.data.renderScale;presentation.debug=settings.data.showDebug;}
  presentation.resize(scale);await presentation.warm();await loadRoom();
  $('#clip').innerHTML=Object.keys(loader.manifest.asset.clips).map(c=>`<option>${c}</option>`).join('');$<HTMLSelectElement>('#clip').value='walk';$('#heading').innerHTML=HEADINGS.map(d=>`<option>${d}</option>`).join('');$<HTMLSelectElement>('#heading').value='d45';
  $('#clip').onchange=()=>{presentation.labClip=$<HTMLSelectElement>('#clip').value;presentation.notifyLog=[];};$('#heading').onchange=()=>{presentation.labHeading=$<HTMLSelectElement>('#heading').value as typeof HEADINGS[number];presentation.notifyLog=[];};
  $('#play').onclick=()=>{presentation.labPaused=!presentation.labPaused;$('#play').textContent=presentation.labPaused?'Play':'Pause';};
  $('#step').onclick=()=>{presentation.labPaused=true;$('#play').textContent='Play';const c=presentation.labAnimator.clip,t=presentation.labAnimator.time%clipDuration(c);let end=0;for(const duration of c.durationsMs){end+=duration;if(end>t+.01)break;}presentation.labAnimator.seek(end>=clipDuration(c)?0:end);presentation.labTime=presentation.labAnimator.time;};
  $('#scrub').oninput=()=>{presentation.labPaused=true;$('#play').textContent='Play';presentation.labAnimator.seek(Number($<HTMLInputElement>('#scrub').value));presentation.labTime=presentation.labAnimator.time;};
  $('#speed').onchange=()=>presentation.labSpeed=Number($<HTMLSelectElement>('#speed').value);
  $('#overlays').onchange=()=>presentation.debug=$<HTMLInputElement>('#overlays').checked;
  $('#calibration-debug').onchange=()=>presentation.debug=$<HTMLInputElement>('#calibration-debug').checked;
  $('#collision').onchange=()=>presentation.debug=$<HTMLInputElement>('#collision').checked;
  for(const id of ['background','calibration-background'])$('#'+id).onchange=()=>presentation.background=$<HTMLSelectElement>('#'+id).value;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(el=>el.onclick=()=>setMode(el.dataset.mode as Mode));
  $('#pause').onclick=()=>pause(!paused);$('#resume').onclick=()=>pause(false);$('#reset').onclick=()=>safe(loadRoom);
  $('#save').onclick=()=>safe(async()=>{if(sim.cleared)wins++;await bridge.saveGame(saveValue());await bridge.saveSettings({version:1,renderScale:scale,showDebug:presentation.debug});status('Checkpoint saved');});
  $('#load').onclick=()=>safe(async()=>{const result=await bridge.loadGame();if(result.status==='ok'||result.status==='recovered'){restore(result.data);pause(false);status(result.status==='recovered'?'Loaded backup checkpoint':'Checkpoint loaded');}else status(result.status==='unreadable'?result.message:'No saved checkpoint');});
  $<HTMLSelectElement>('#render-scale').value=String(scale);$('#render-scale').onchange=()=>{scale=Number($<HTMLSelectElement>('#render-scale').value);presentation.resize(scale);};
  $('#occlude-front').onclick=()=>{sim.hero.x=-1.2;sim.hero.z=.8;sim.hero.px=sim.hero.x;sim.hero.pz=sim.hero.z;};$('#occlude-back').onclick=()=>{sim.hero.x=-2.8;sim.hero.z=-.8;sim.hero.px=sim.hero.x;sim.hero.pz=sim.hero.z;};
  window.addEventListener('resize',()=>presentation.resize(scale));window.addEventListener('blur',()=>{if(ready){pause(true);last=performance.now();}});document.addEventListener('visibilitychange',()=>{if(document.hidden&&ready)pause(true);last=performance.now();clock.reset();});
  ready=true;status('Ready · development proxy / diagnostics');last=performance.now();requestAnimationFrame(loop);
}
function loop(now:number){const ms=Math.max(0,now-last);last=now;let alpha=1;
  if(!paused&&(mode==='encounter'||benchmark))alpha=clock.advance(ms,()=>{const cmd=benchmarkCommand??input.consume();aim=cmd.aim;sim.step(cmd);if(!benchmark&&(sim.hero.health<=0||sim.cleared))pause(true);});
  else if(!paused&&mode==='occlusion'){alpha=clock.advance(ms,()=>{const cmd=input.consume();aim=cmd.aim;sim.actors.slice(1).forEach(a=>a.stun=2);sim.step(cmd);});}
  presentation.update(sim,alpha,paused?0:ms,aim);
  if(benchmark)benchmarkFrames.push(ms);
  if(mode==='animation'){
    const c=presentation.labAnimator.clip,duration=clipDuration(c);$<HTMLInputElement>('#scrub').max=String(duration);$<HTMLInputElement>('#scrub').value=String(presentation.labTime%duration);$('#visual-time').textContent=`${Math.round(presentation.labTime%duration)} / ${duration} ms`;
    $('#notify').textContent=presentation.notifyLog.join('\n');const f=presentation.frameMap.get(presentation.labAnimator.frame)!;$('#frame-status').textContent=`${f.origin.toUpperCase()} · ${f.id} · untrimmed foot (${loader.manifest.asset.anchor.join(',')})`;
  }
  $('#hp').textContent=`${sim.hero.health} / 100`;$<HTMLElement>('#health-fill').style.width=`${sim.hero.health}%`;$('#enemy-count').textContent=`${sim.actors.slice(1).filter(a=>a.health>0).length} wardens remain`;$('#state').textContent=sim.hero.state;
  $('#dodge-status').textContent=`Shift · ${sim.hero.dodgeCooldown?(sim.hero.dodgeCooldown/60).toFixed(1)+' s':'ready'}`;$('#ability-status').textContent=`RMB · ${sim.hero.cooldown?(sim.hero.cooldown/60).toFixed(1)+' s':'ready'}`;
  requestAnimationFrame(loop);
}
// Narrow inspection hook for local verification/benchmark. No privileged operations or save bypass.
Object.assign(window,{foundation:{get ready(){return ready;},get sim(){return sim;},get presentation(){return presentation;},get manifest(){return loader?.manifest;},mode:setMode,pause,reset:loadRoom,stats:()=>presentation.stats(),saveValue,
  startBenchmark(stress=false){benchmark=true;benchmarkFrames=[];pause(false);setMode('encounter');sim=new Simulation();if(stress)for(let i=5;i<=32;i++)sim.actors.push(sim.create(i,'enemy',(i%6-3)*1.2,(Math.floor(i/6)-2)*1.2));benchmarkCommand={move:{x:.7,z:-.7},aim:{x:0,z:0},attack:true};},
  finishBenchmark(){benchmark=false;benchmarkCommand=undefined;return{frames:benchmarkFrames,stats:presentation.stats(),droppedMs:clock.droppedMs};},
  dispose(){roomAbort.abort();input.dispose();presentation.dispose();roomRelease?.();heroRelease?.();}
}});
boot().catch(e=>{status(`Boot failed: ${e.message}`);$('#status').classList.add('error');console.error(e);});
