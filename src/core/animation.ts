import type { Clip } from '../assets/schema';
export function clipDuration(clip:Clip) {return clip.durationsMs.reduce((a,b)=>a+b,0);}
export function frameAt(clip:Clip,timeMs:number) {
  const duration=clipDuration(clip),t=clip.loop?Math.max(0,timeMs)%duration:Math.min(Math.max(0,timeMs),duration-0.0001);
  let end=0;for(let i=0;i<clip.frames.length;i++){end+=clip.durationsMs[i]!;if(t<end)return clip.frames[i]!;}return clip.frames.at(-1)!;
}
export class Animator {
  time=0;instance=0;
  constructor(public actor:string,public clip:Clip) {}
  start(clip:Clip) {this.clip=clip;this.time=0;this.instance++;}
  seek(time:number) {this.time=Math.max(0,time);} // silent; no gameplay/audio authority
  advance(ms:number) {
    const from=this.time,to=from+Math.max(0,ms),duration=clipDuration(this.clip),events:{key:string;kind:string}[]=[];
    const first=Math.floor(from/duration),last=this.clip.loop?Math.floor(to/duration):0;
    for(let loop=this.clip.loop?first:0;loop<=last;loop++) for(const event of this.clip.notifies){
      const at=loop*duration+event.atMs;
      if(at>from&&at<=to)events.push({key:`${this.actor}:${this.instance}:${loop}:${event.id}`,kind:event.kind});
    }
    this.time=to;return events;
  }
  get frame(){return frameAt(this.clip,this.time);}
}
