import type {PreparedRegistration} from './assets/registration';
import {AssetRuntime,type PackLease} from './assets/loader';
import type {GamePresentation} from './presentation/game-scene';
import {GameSession} from './core/session';
import {FixedClock,type Command} from './core/simulation';
import {Persistence} from './core/persistence';
import {EventHub,type GameplayEvent} from './core/events';
import {Input} from './core/input';
import {actorVisuals} from './content/visuals';
import {areaArtAssets,validateAreaArt} from './content/world-art';
import {ContentRegistry} from './content/world';
import {visualEffectsAssets} from './content/visual-effects-assets';
import {parseGame,type GameSave,type Bridge} from './core/save';
export type ApplicationHooks={status:(message:string,error?:boolean)=>void;pause:(paused:boolean)=>void;frame:()=>void};
// Both launch experiences own exactly this session/loading/input/persistence lifecycle.
export class Application<P extends GamePresentation=GamePresentation>{
 session:GameSession;presentation!:P;input!:Input;runtime!:AssetRuntime;
 persistence:Persistence;events=new EventHub();clock=new FixedClock();packs=new Map<string,PackLease>();
 persistentLeases=new Map<string,PackLease>();private roomLeases=new Map<string,PackLease>();
 private abort=new AbortController();private request=0;private last=0;private frameId=0;private disposed=false;
 private aim={x:0,z:1};private assetLoads=new Map<string,Promise<void>>();
 private assertActive(){if(this.disposed)throw new Error('application disposed');}
 ready=false;busy=false;paused=false;readOnly=false;scale=1;settingsError='';command:((sim:GameSession['sim'])=>Command)|undefined;
 afterFrame:(ms:number)=>void=()=>{};
 constructor(readonly canvas:HTMLCanvasElement,readonly registry:ContentRegistry,readonly catalog:Readonly<Record<string,string>>,readonly bridge:Bridge,readonly createPresentation:(canvas:HTMLCanvasElement,packs:Map<string,PackLease>,events:EventHub,area:import('./content/world').AreaDefinition,registration:PreparedRegistration)=>P,readonly hooks:ApplicationHooks,readonly extraAssets:readonly string[]=[]){this.session=new GameSession(registry);this.persistence=new Persistence(bridge);}
 get sim(){return this.session.sim;}
 private onResize=()=>this.presentation?.resize(this.scale);
 private onBlur=()=>{if(this.ready)this.pause(true);};
 private onVisibility=()=>{if(document.hidden)this.onBlur();this.clock.reset();this.last=performance.now();};
 async boot(){
  this.assertActive();this.runtime=await AssetRuntime.open(this.catalog);this.assertActive();
  const hero=actorVisuals[this.registry.actor(this.registry.definitions.player).visual]!.asset;
  for(const id of [...new Set([hero,...visualEffectsAssets.filter(id=>id in this.catalog),...this.extraAssets])]){const pack=await this.runtime.loadPack(id,this.abort.signal);if(this.disposed){pack.release();this.assertActive();}this.persistentLeases.set(id,pack);this.packs.set(id,pack);}
  this.roomLeases=await this.acquireArea(this.sim.area,this.abort.signal);for(const [id,p]of this.roomLeases)this.packs.set(id,p);
  this.presentation=this.createPresentation(this.canvas,this.packs,this.events,this.sim.areaDefinition,this.runtime.registration);this.presentation.generation=this.session.generation;
  this.events.setGeneration(this.session.generation);
  this.input=new Input(this.canvas,this.presentation.camera,()=>this.pause(!this.paused));
  const settings=await this.bridge.loadSettings();this.assertActive();if(settings.status==='ok'||settings.status==='recovered'){this.scale=settings.data.renderScale;this.presentation.verticalSpan=settings.data.verticalSpan;this.presentation.setDepthOfField(settings.data.depthOfField);this.presentation.setVisualEffects(settings.data.visualEffects);}else if(settings.status==='unreadable')this.settingsError=settings.message;
  await this.persistence.inspect();this.assertActive();this.presentation.resize(this.scale);await this.presentation.loadWalkFlow();this.assertActive();await this.presentation.warm();this.assertActive();
  window.addEventListener('resize',this.onResize);window.addEventListener('blur',this.onBlur);document.addEventListener('visibilitychange',this.onVisibility);
  this.ready=true;this.canvas.dataset.ready='true';this.last=performance.now();this.frameId=requestAnimationFrame(this.loop);
 }
 async loadAsset(id:string){
  this.assertActive();if(this.persistentLeases.has(id))return;
  const pending=this.assetLoads.get(id);if(pending)return pending;
  const load=(async()=>{const pack=await this.runtime.loadPack(id,this.abort.signal);
   try{this.assertActive();this.presentation.warmPack(pack);}catch(error){pack.release();throw error;}
   this.persistentLeases.set(id,pack);this.packs.set(id,pack);
  })();this.assetLoads.set(id,load);
  try{await load;}finally{this.assetLoads.delete(id);}
 }
 private async acquireArea(area:string,signal:AbortSignal){const def=this.registry.area(area),ids=[...new Set([...areaArtAssets(def),...def.spawns.map(s=>actorVisuals[this.registry.actor(s.actor).visual]!.asset)])];
  const results=await Promise.allSettled(ids.map(id=>this.runtime.loadPack(id,signal))),leases=new Map<string,PackLease>();
  results.forEach((r,i)=>{if(r.status==='fulfilled')leases.set(ids[i]!,r.value);});
  try{const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;if(signal.aborted)throw new Error('load cancelled');validateAreaArt(def,leases);
   for(const spawn of def.spawns){const visual=actorVisuals[this.registry.actor(spawn.actor).visual]!,manifest=leases.get(visual.asset)!.manifest;for(const name of [...Object.values(visual.clips),...visual.attacks])if(!manifest.asset.clips[name])throw new Error(`missing clip ${name}`);}
   return leases;
  }catch(error){for(const p of leases.values())p.release();throw error;}
 }
 publish(events:readonly GameplayEvent[]){this.events.setGeneration(this.session.generation);this.events.publish(events);}
 async replaceArea(area:string,commit:()=>readonly GameplayEvent[]){const request=++this.request;this.abort.abort();const controller=new AbortController();this.abort=controller;this.busy=true;this.clock.reset();this.input.clear();let next:Map<string,PackLease>|undefined;
  try{next=await this.acquireArea(area,controller.signal);if(this.disposed||request!==this.request)throw new Error('load cancelled');for(const pack of next.values())this.presentation.warmPack(pack);
   const changes=commit(),old=this.roomLeases;this.roomLeases=next;for(const [id,p]of next)this.packs.set(id,p);for(const [id,p]of this.persistentLeases)this.packs.set(id,p);
   this.presentation.resetRoom(this.sim.areaDefinition);this.presentation.generation=this.session.generation;for(const [id,p]of old){p.release();if(!next.has(id)&&!this.persistentLeases.has(id))this.packs.delete(id);}next=undefined;this.input.resetAim();this.publish(changes);
  }finally{if(next)for(const p of next.values())p.release();if(request===this.request)this.busy=false;}
 }
 pause(value:boolean){this.paused=value;this.clock.reset();this.input?.clear();this.last=performance.now();this.hooks.pause(value);}
 safe(fn:()=>Promise<unknown>){void fn().catch(error=>this.hooks.status(String(error.message??error),true));}
 async transition(id:string){const plan=this.session.prepareTransition(id);this.publish(plan.events);try{await this.replaceArea(plan.destination,()=>this.session.commitTransition(plan));this.autosave();}catch(error){this.publish(this.session.cancelTransition(plan));this.pause(true);throw error;}}
 async reset(){await this.replaceArea(this.sim.area,()=>this.session.resetCurrentArea());this.pause(false);}
 async restore(save:GameSave){const valid=parseGame(save,this.registry);await this.replaceArea(valid.area,()=>this.session.restoreSave(valid));this.persistence.loaded();this.pause(false);}
 async newGame(){await this.replaceArea(this.registry.definitions.initialArea,()=>{this.session=new GameSession(this.registry,142,this.registry.definitions.initialArea,this.session.generation+1);return [];});this.persistence.confirmNew();if(!this.readOnly)await this.persistence.save(this.session.captureSave());this.pause(false);}
 async saveSettings(){await this.bridge.saveSettings({version:5,renderScale:this.scale,showDebug:false,verticalSpan:this.presentation.verticalSpan,depthOfField:this.presentation.depthOfField,visualEffects:this.presentation.visualEffects});this.settingsError='';}
 async save(){if(this.readOnly)throw new Error('Sandbox sessions cannot write checkpoints');await this.persistence.save(this.session.captureSave());await this.saveSettings();}
 autosave(){if(!this.readOnly)this.safe(()=>this.persistence.save(this.session.captureSave(),true));}
 private loop=(now:number)=>{if(this.disposed)return;const ms=Math.max(0,now-this.last);this.last=now;let alpha=1;let aim=this.aim;
  if(!this.paused&&!this.busy&&(this.presentation.mode==='encounter'||this.presentation.mode==='occlusion'||this.presentation.mode==='lighting'))alpha=this.clock.advance(ms,()=>{
   const sim=this.sim;if(this.presentation.mode==='occlusion')sim.enemies.forEach(a=>a.stun=2);
   const cmd=this.command?.(sim)??this.input.consume(sim.hero,sim.areaDefinition,sim.generation);aim=cmd.aim;this.aim=aim;const result=this.session.step(cmd);this.publish(result.events);
   if(result.reset){this.input.resetAim();this.autosave();return false;}if(result.transition&&!this.command){this.safe(()=>this.transition(result.transition!));return false;}return true;
  });
  this.presentation.update(this.sim,alpha,this.paused||this.busy?0:ms,aim);this.hooks.frame();this.afterFrame(ms);this.frameId=requestAnimationFrame(this.loop);
 };
 dispose(){if(this.disposed)return;this.disposed=true;this.ready=false;this.abort.abort();cancelAnimationFrame(this.frameId);window.removeEventListener('resize',this.onResize);window.removeEventListener('blur',this.onBlur);document.removeEventListener('visibilitychange',this.onVisibility);this.input?.dispose();this.presentation?.dispose();for(const p of this.roomLeases.values())p.release();for(const p of this.persistentLeases.values())p.release();this.events.dispose();}
}
