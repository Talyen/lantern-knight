import * as T from 'three';
import type {ActorSprite} from './sprite';
import {right,up} from '../core/camera';
import {cardCoverage,type CoverageMask} from './scenery-reveal';
export function coplanarArtConflicts(sprites:ActorSprite[],masks:Record<string,CoverageMask>){
 const records=sprites.filter(s=>s.manifest.asset.type==='prop').map(s=>{s.mesh.updateMatrixWorld(true);const position=s.geometry.getAttribute('position'),points=Array.from({length:position.count},(_,i)=>new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(s.mesh.matrixWorld));const normal=points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();return {s,points,normal,left:Math.min(...points.map(p=>p.dot(right))),right:Math.max(...points.map(p=>p.dot(right))),bottom:Math.min(...points.map(p=>p.dot(up))),top:Math.max(...points.map(p=>p.dot(up)))};});
 const conflicts:{a:string;b:string;separation:number}[]=[];
 for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){const a=records[i]!,b=records[j]!,separation=Math.abs(b.points[0]!.clone().sub(a.points[0]!).dot(a.normal));if(Math.abs(a.normal.dot(b.normal))<.99999||separation>.001)continue;const left=Math.max(a.left,b.left),rightEdge=Math.min(a.right,b.right),bottom=Math.max(a.bottom,b.bottom),top=Math.min(a.top,b.top);if((rightEdge-left)*(top-bottom)<.002||left>=rightEdge||bottom>=top)continue;
  let hits=0;for(let y=0;y<12;y++)for(let x=0;x<12;x++){const point=new T.Vector3().addScaledVector(right,left+(x+.5)/12*(rightEdge-left)).addScaledVector(up,bottom+(y+.5)/12*(top-bottom));if(cardCoverage(a.s,point,masks[`${a.s.manifest.asset.id}:${a.s.animator.frame}`])>.45&&cardCoverage(b.s,point,masks[`${b.s.manifest.asset.id}:${b.s.animator.frame}`])>.45)hits++;}
  if(hits>=2)conflicts.push({a:a.s.id,b:b.s.id,separation});
 }
 return conflicts;
}
