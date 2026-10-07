import * as T from 'three';
import {ActorSprite} from './sprite';
import {FoliageWind} from './foliage-wind';
import {IllustratedRain} from './illustrated-rain';
import {resolveClip} from '../assets/schema';
import {frameAt,clipDuration} from '../core/animation';
import {heightAt,type AreaDefinition} from '../content/world';
import {worldVisuals} from '../content/world-art';
import {lightFlicker,dryWeather,normalizeWeather,type WeatherState,type VisualEffects} from '../content/visual-effects';
import type {PackLease} from '../assets/loader';
type Fixture={body?:ActorSprite;flame?:ActorSprite;position:T.Vector3;phase:number;power:number;range:number;smoke?:ActorSprite;embers:ActorSprite};
export class SceneVisualEffects {
 readonly group=new T.Group();time=0;private fixtures:Fixture[]=[];private winds:FoliageWind[]=[];private generation=-1;private rain?:IllustratedRain;private requestedWeather?:WeatherState;private area?:AreaDefinition;
 constructor(private packs:Map<string,PackLease>,private camera:T.OrthographicCamera){this.group.name='visual-effects';}
 setWeather(state:WeatherState|null){this.requestedWeather=state?normalizeWeather(state):undefined;}
 private effect(id:string,asset:string){const p=this.packs.get(asset)!;if(!p)throw new Error(`ambience pack unavailable: ${asset}`);const s=new ActorSprite(id,p.manifest,p.textures,resolveClip(p.manifest,'show','d45'));s.mesh.userData.decorative=true;this.group.add(s.mesh);return s;}
 private build(area:AreaDefinition,generation:number,sprites:ActorSprite[]){this.reset();this.area=area;this.generation=generation;const art=worldVisuals[area.id];if(!art)return;
  for(const p of art.props.filter(p=>p.light||art.fixtures?.some(f=>f.prop===p.id))){
   const scale=p.scale??1,f=art.fixtures?.find(f=>f.prop===p.id),l=p.light??{offset:f!.socket.map(v=>v/scale) as [number,number,number],power:f!.power,range:f!.radius,phase:f!.phase},body=sprites.find(s=>s.id===p.id),flame=sprites.find(s=>s.id===(f?.id??`${p.id}-flame`)),position=new T.Vector3(p.x+l.offset[0]*scale,heightAt(area,p.x,p.z)+(p.y??0)+l.offset[1]*scale,p.z+l.offset[2]*scale),smoking=f?.smoke??p.flame?.clip==='cresset';
   const smoke=smoking?this.effect(`${p.id}-smoke-fx`,'fx-smoke'):undefined,embers=this.effect(`${p.id}-embers-fx`,'fx-embers');if(smoke)smoke.mesh.scale.setScalar(.26);embers.mesh.scale.setScalar(p.flame?.clip==='votive'?.16:.28);
   const prior=sprites.find(s=>s.id===`${f?.id}-smoke`);if(prior)prior.mesh.userData.replacedAmbient=true;
   this.fixtures.push({body,flame,position,phase:l.phase,power:l.power,range:l.range,smoke,embers});
  }
  for(const [i,p]of art.props.entries())if(['tree','yew','pine','birch','juniper','fern','bramble','roots'].includes(p.clip)){
   const sprite=sprites.find(s=>s.id===p.id);if(!sprite)continue;const wind=new FoliageWind(sprite,i*.73);if(sprite.mesh.customDepthMaterial)wind.attach(sprite.mesh.customDepthMaterial);this.winds.push(wind);
  }
 }
 update(area:AreaDefinition,generation:number,sprites:ActorSprite[],ms:number,options:VisualEffects){
  if(generation!==this.generation||area.id!==this.area?.id)this.build(area,generation,sprites);this.time+=Math.max(0,ms)/1000;
  for(const wind of this.winds)wind.update(this.time,options.wind);
  for(const s of sprites)if(s.mesh.userData.replacedAmbient)s.mesh.visible=false;
  for(const f of this.fixtures){const opacity=f.body?.material.opacity??1,visible=f.body?.mesh.visible??true;
   if(f.flame){const clip=f.flame.animator.clip,position=f.flame.mesh.position.clone(),scale=f.flame.mesh.scale.clone();f.flame.show(frameAt(clip,options.livingLights?((this.time+f.phase)*1000)%clipDuration(clip):0),position,this.camera);f.flame.mesh.scale.copy(scale);f.flame.mesh.visible=visible;f.flame.material.opacity=opacity;f.flame.material.color.setScalar(options.livingLights?lightFlicker(this.time,f.phase):1);}
   for(const s of [f.smoke,f.embers])if(s){const clip=s.animator.clip,scale=s.mesh.scale.clone(),root=f.position.clone();if(s===f.smoke&&options.wind)root.x+=Math.sin(this.time*.7+f.phase)*.06;s.show(frameAt(clip,((this.time+f.phase)*1000)%clipDuration(clip)),root,this.camera);s.mesh.scale.copy(scale);s.mesh.visible=options.smoke&&visible;s.material.opacity=opacity;}
  }
  const art=worldVisuals[area.id],weather=this.requestedWeather??art?.weather??dryWeather(),enabled=options.rain&&!art?.interior;
  if(enabled&&weather.rain>0&&!this.rain){this.rain=new IllustratedRain(this.packs,area.seedOffset);this.group.add(this.rain.group);}
  this.rain?.update(this.time,weather,enabled,this.camera,{bounds:art?.rainBounds??area.bounds,shelters:art?.rainShelters??[],height:(x,z)=>heightAt(area,x,z)});
 }
 lights(options:VisualEffects){return this.fixtures.map(f=>({position:f.position,power:f.power*(options.livingLights?lightFlicker(this.time,f.phase):1)*(f.body?.material.opacity??1)*(f.body?.mesh.visible===false?0:1),range:f.range}));}
 reset(){for(const f of this.fixtures){f.smoke?.dispose();f.embers.dispose();}this.fixtures=[];this.winds=[];this.rain?.dispose();this.rain=undefined;this.group.clear();this.time=0;this.generation=-1;}
 stats(){return {weather:this.requestedWeather??worldVisuals[this.area?.id??'']?.weather??dryWeather(),fixtures:this.fixtures.length,rain:this.rain?.stats()??{visible:false,drops:0,impacts:[],slots:0}};}
 dispose(){this.reset();this.group.removeFromParent();}
}
