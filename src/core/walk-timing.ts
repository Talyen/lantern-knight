import type {Clip} from '../assets/schema';
import {clipDuration} from './animation';
export const walkTimings={
 supplied:{label:'Supplied · 1.00 s',description:'The supplied drawing holds.',ticks:[5,4,4,4,4,3,3,3,5,4,4,4,4,3,3,3]},
 weighted:{label:'Weighted · 1.00 s',description:'Contact and loading drawings last longer; early in-betweens pass sooner. Movement speed stays unchanged.',ticks:[6,3,5,3,4,3,3,3,6,3,5,3,4,3,3,3]},
 relaxed:{label:'Relaxed · 1.10 s',description:'A slower trial with longer contact/loading holds. Compare foot sliding at the unchanged movement speed.',ticks:[7,3,6,3,4,3,3,4,7,3,6,3,4,3,3,4]},
} as const;
export type WalkTiming=keyof typeof walkTimings;
const cached=new WeakMap<Clip,Map<WalkTiming,Clip>>();
export function timedWalk(clip:Clip,timing:WalkTiming):Clip{
 if(timing==='supplied')return clip;
 if(clip.frames.length!==16||clip.notifies.length)throw new Error('walk timing trials require sixteen silent drawing holds');
 let versions=cached.get(clip);if(!versions){versions=new Map();cached.set(clip,versions);}
 let result=versions.get(timing);if(!result){result={...clip,durationsMs:walkTimings[timing].ticks.map(t=>t*1000/60)};versions.set(timing,result);}return result;
}
// Keep the current drawing and its fractional hold when changing rhythm.
export function remapWalkTime(from:Clip,to:Clip,time:number){
 if(from.frames.length!==to.frames.length||from.frames.some((id,i)=>id!==to.frames[i]))return 0;
 const duration=clipDuration(from),loop=from.loop?Math.floor(Math.max(0,time)/duration):0,t=from.loop?Math.max(0,time)%duration:Math.min(Math.max(0,time),duration-.0001);
 let a=0,b=0;for(let i=0;i<from.frames.length;i++){const hold=from.durationsMs[i]!;if(t<a+hold)return loop*clipDuration(to)+b+(t-a)/hold*to.durationsMs[i]!;a+=hold;b+=to.durationsMs[i]!;}return b;
}
