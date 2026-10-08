import './effects-playground.css';
import {AssetRuntime,type PackLease} from './assets/loader';
import {ContentRegistry} from './content/world';
import {Simulation,FixedClock} from './core/simulation';
import {Input} from './core/input';
import {outward} from './core/camera';
import {EffectsPlayground} from './presentation/effects-playground';
import {effectLabels,effectsDefinitions,playgroundCatalog,playgroundDefaults,type PlaygroundEffect} from './content/effects-playground';
import './inspection';
import {FrameScheduler} from './frame-scheduler';

const settings=playgroundDefaults(),$=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
document.getElementById('app')!.innerHTML=`<header><div><strong>Effects Playground</strong><span>Separate developer scene · SMAA 1× High</span></div><button id="back">Return to Sandbox</button></header>
 <main><canvas id="scene" tabindex="0" aria-label="Effects Playground game"></canvas><aside><h1>Compare effects</h1>
 <label>Treatment<select id="treatment"><option value="quiet">Quiet ink</option><option value="rich">Richer HD-2D</option></select></label>
 <label class="compare"><input type="checkbox" id="baseline">Compare with all off</label>
 <div class="buttons"><button id="all-on">All on</button><button id="all-off">All off</button></div>
 ${Object.entries(effectLabels).map(([key,label])=>`<label><input type="checkbox" data-effect="${key}" checked>${label}</label>`).join('')}
 <fieldset><legend>Outline appearance</legend><label>Thickness <output id="outline-width-value">1 px</output><input id="outline-width" type="range" min="0.5" max="2" step="0.25" value="1"></label><label>Opacity <output id="outline-opacity-value">25%</output><input id="outline-opacity" type="range" min="0" max="50" step="5" value="25"></label><label>Color<input id="outline-color" type="color" value="#29343b"></label></fieldset>
 <div class="buttons"><button id="pause">Pause</button><button id="reset">Replay from start</button></div>
 <p>WASD move · Shift dash · mouse aim · sword / lantern controls work. The left platform is sheltered from rain.</p><p>Switch one effect at a time, or compare your selection against all off.</p><output id="stats"></output></aside></main><footer id="status" role="status">Loading playground artwork…</footer>`;
const registry=new ContentRegistry(effectsDefinitions);let sim=new Simulation(903,effectsDefinitions.initialArea,0,registry),runtime:AssetRuntime,view:EffectsPlayground,input:Input;
const packs=new Map<string,PackLease>(),clock=new FixedClock();let ready=false,disposed=false,last=0;const abort=new AbortController();let frames:FrameScheduler|undefined;
const automated=window.lantern?.automatedRun??false;
const resetFrameClock=()=>{clock.reset();last=performance.now();};
const onResize=()=>view.resize(),onBlur=()=>{settings.paused=true;resetFrameClock();input.clear();synchronize();},onVisibility=()=>{if(document.hidden)onBlur();resetFrameClock();};
function assertActive(){if(disposed)throw new Error('playground disposed');}
function synchronize(){for(const box of document.querySelectorAll<HTMLInputElement>('[data-effect]'))box.checked=settings.effects[box.dataset.effect as PlaygroundEffect];$('baseline').classList.toggle('active',settings.baseline);$<HTMLInputElement>('baseline').checked=settings.baseline;$<HTMLSelectElement>('treatment').value=settings.treatment;$('pause').textContent=settings.paused?'Resume':'Pause';}
function pause(){settings.paused=!settings.paused;clock.reset();input?.clear();synchronize();}
function reset(){sim=new Simulation(903,effectsDefinitions.initialArea,sim.generation+1,registry);view.time=0;clock.reset();input.clear();}
function render(ms:number){if(!ready||disposed)return;const frozen=settings.paused||(frames?.idle??(!automated&&(document.hidden||!document.hasFocus())));const alpha=frozen?1:clock.advance(ms,()=>{sim.enemies.forEach(e=>e.stun=2);sim.step(input.consume(sim.hero,sim.areaDefinition,sim.generation));if(sim.hero.health<=0)reset();});view.draw(sim,alpha,frozen?0:ms,settings);}
function loop(now:number){const ms=Math.min(100,Math.max(0,now-last));last=now;render(ms);const s=view.stats();$('stats').textContent=`${settings.baseline?'All effects off':settings.treatment==='quiet'?'Quiet ink':'Richer HD-2D'}\n${s.buffer.join(' × ')} · ${s.objects.textures} textures\nTime ${s.time.toFixed(1)} s`;
}
async function boot(){runtime=await AssetRuntime.open(playgroundCatalog);assertActive();
 const results=await Promise.allSettled(Object.keys(playgroundCatalog).map(async id=>{const pack=await runtime.loadPack(id,abort.signal);if(disposed){pack.release();assertActive();}packs.set(id,pack);}));
 const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;assertActive();
 const response=await fetch('/dev-effects/emitters.json');if(!response.ok)throw new Error('playground emitter registration missing');
 const emitters=await response.json();assertActive();view=new EffectsPlayground($('scene'),packs,emitters);view.camera.position.set(0,0,0).addScaledVector(outward,30);view.camera.lookAt(0,0,0);view.camera.updateMatrixWorld();
 input=new Input($('scene'),view.camera,pause);await view.prepare();assertActive();
 for(const box of document.querySelectorAll<HTMLInputElement>('[data-effect]'))box.onchange=()=>settings.effects[box.dataset.effect as PlaygroundEffect]=box.checked;
 $('baseline').onchange=()=>{settings.baseline=$<HTMLInputElement>('baseline').checked;synchronize();};
 $('treatment').onchange=()=>settings.treatment=$<HTMLSelectElement>('treatment').value as 'quiet'|'rich';
 for(const [id,enabled]of [['all-on',true],['all-off',false]] as const)$(id).onclick=()=>{for(const key of Object.keys(effectLabels) as PlaygroundEffect[])settings.effects[key]=enabled;settings.baseline=false;synchronize();};
 $('outline-width').oninput=()=>{settings.outline.thickness=Number($<HTMLInputElement>('outline-width').value);$('outline-width-value').textContent=settings.outline.thickness+' px';};$('outline-opacity').oninput=()=>{settings.outline.opacity=Number($<HTMLInputElement>('outline-opacity').value)/100;$('outline-opacity-value').textContent=Math.round(settings.outline.opacity*100)+'%';};$('outline-color').oninput=()=>settings.outline.color=$<HTMLInputElement>('outline-color').value;
 $('pause').onclick=pause;$('reset').onclick=reset;
 $('back').onclick=()=>{if(window.lantern?.launchMode)void window.lantern.launchMode('sandbox');else location.href='/sandbox.html';};
 window.addEventListener('resize',onResize);window.addEventListener('blur',onBlur);document.addEventListener('visibilitychange',onVisibility);
 ready=true;last=performance.now();$('scene').dataset.ready='true';$('status').textContent='Developer experiment only · no checkpoints or settings written';if(!automated&&(document.hidden||!document.hasFocus()))onBlur();frames=new FrameScheduler(loop,resetFrameClock,automated);}
function dispose(){if(disposed)return;disposed=true;ready=false;abort.abort();frames?.dispose();window.removeEventListener('resize',onResize);window.removeEventListener('blur',onBlur);document.removeEventListener('visibilitychange',onVisibility);input?.dispose();view?.dispose();packs.forEach(p=>p.release());}
window.effectsPlayground={get ready(){return ready;},get settings(){return structuredClone(settings);},setEffect(key:PlaygroundEffect,value:boolean){settings.effects[key]=value;synchronize();},setBaseline(value:boolean){settings.baseline=value;synchronize();},setTreatment(value:'quiet'|'rich'){settings.treatment=value;synchronize();},pause(value:boolean){settings.paused=value;clock.reset();input?.clear();synchronize();},step(ms:number){view.draw(sim,1,ms,{...settings,paused:false});},render(){view.draw(sim,1,0,settings);},reset,stats:()=>view.stats(),diagnostics:()=>view.diagnostics(),dispose};
window.addEventListener('beforeunload',dispose);boot().catch(error=>{$('status').textContent=`Playground failed: ${error.message}`;console.error(error);dispose();});

declare global{interface Window{effectsPlayground:{readonly ready:boolean;readonly settings:ReturnType<typeof playgroundDefaults>;setEffect(key:PlaygroundEffect,value:boolean):void;setBaseline(value:boolean):void;setTreatment(value:'quiet'|'rich'):void;pause(value:boolean):void;step(ms:number):void;render():void;reset():void;stats():ReturnType<EffectsPlayground['stats']>;diagnostics():ReturnType<EffectsPlayground['diagnostics']>;dispose():void;};}}
