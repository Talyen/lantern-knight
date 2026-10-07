import type {Clip} from '../assets/schema';
import {clipDuration} from './animation';
export const animationTreatments={
  original:{label:'Original · held frames',description:'Authored held drawings; walk rhythm follows the selected timing.'},
  guarded:{label:'Guarded motion warp',description:'Registered guarded motion and rigid sword protection. Incompatible poses retain authored holds.',motion:true,guarded:true},

} as const;
export type AnimationTreatment=keyof typeof animationTreatments;
export type FrameBlend={from:string;to:string;mix:number;motion:boolean;guarded:boolean};
export function sampleAnimation(clip:Clip,timeMs:number,mode:AnimationTreatment):FrameBlend{
  const duration=clipDuration(clip),time=clip.loop?Math.max(0,timeMs)%duration:Math.min(Math.max(0,timeMs),duration-0.0001);
  const guarded=mode==='guarded';
  let start=0;
  for(let i=0;i<clip.frames.length;i++){
    const hold=clip.durationsMs[i]!;
    if(time<start+hold||i===clip.frames.length-1){
      let mix=(time-start)/hold;
      if(mode==='original')mix=0;
      const next=clip.loop?(i+1)%clip.frames.length:Math.min(i+1,clip.frames.length-1);
      return{from:clip.frames[i]!,to:clip.frames[next]!,mix,motion:guarded,guarded};
    }
    start+=hold;
  }
  throw new Error('walk blend requires a valid clip');
}
