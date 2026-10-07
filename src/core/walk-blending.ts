import type {Clip} from '../assets/schema';
import {clipDuration} from './animation';
export const walkBlendModes={
  original:{label:'Original · held frames',description:'The sixteen supplied drawings, held at the selected walk timing.'},
  dissolve:{label:'Short dissolve',description:'Hold each drawing for 80% of its interval, then ease briefly into the next.',hold:.8,eased:true},
  crossfade:{label:'Full crossfade',description:'Blend throughout each frame hold. Smooth transitions can show two silhouettes.'},
  motion:{label:'Motion warp',description:'Continuous estimated motion. Compare equipment bending against the guarded versions.',motion:true},
  eased:{label:'Eased crossfade',description:'Ease into and out of a full-interval crossfade. Mid-transition silhouettes can still ghost.',eased:true},
  guarded:{label:'Guarded motion warp',description:'Continuous guarded body motion with a straight, single-drawing sword when Rigid sword is enabled.',motion:true,guarded:true},
  'guarded-short':{label:'Guarded short warp',description:'Hold for 65%, then ease through guarded motion with optional rigid sword protection.',hold:.65,eased:true,motion:true,guarded:true},
} as const;
export type WalkBlendMode=keyof typeof walkBlendModes;
export type FrameBlend={from:string;to:string;mix:number;motion:boolean;guarded:boolean};
export function sampleWalkBlend(clip:Clip,timeMs:number,mode:WalkBlendMode):FrameBlend{
  const duration=clipDuration(clip),time=clip.loop?Math.max(0,timeMs)%duration:Math.min(Math.max(0,timeMs),duration-0.0001);
  const preset:{label:string;hold?:number;eased?:boolean;motion?:boolean;guarded?:boolean}=walkBlendModes[mode];
  let start=0;
  for(let i=0;i<clip.frames.length;i++){
    const hold=clip.durationsMs[i]!;
    if(time<start+hold||i===clip.frames.length-1){
      let mix=(time-start)/hold;
      if(mode==='original')mix=0;
      if(preset.hold!==undefined)mix=Math.max(0,(mix-preset.hold)/(1-preset.hold));
      if(preset.eased)mix=mix*mix*(3-2*mix);
      const next=clip.loop?(i+1)%clip.frames.length:Math.min(i+1,clip.frames.length-1);
      return{from:clip.frames[i]!,to:clip.frames[next]!,mix,motion:!!preset.motion,guarded:!!preset.guarded};
    }
    start+=hold;
  }
  throw new Error('walk blend requires a valid clip');
}
