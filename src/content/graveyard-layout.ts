import type {Point} from './world';
import type {SiteWall} from './world-art';

export const chapelLayout={frontZ:-6.15,rearZ:-12.1,width:6.4,wallHeight:3.1,ridgeHeight:4.7,facadeHeight:5.6,foundationHeight:.3,doorWidth:1.6,doorHeight:2.65,roofFrontZ:-5.95,roofRearZ:-12.4,roofHalfWidth:3.45,roofBreakZ:-9.6};
export const gatewayLayout={x:-3.25,z:7.55,halfGap:1.25,pierWidth:.48,pierDepth:.46,leftHeight:1.7,rightHeight:1.15,archDepth:.3};
// One settled family terrace. The older eastern burials return to the woodland floor.
export const burialTerraces=[
 {id:'west-family',height:.3,points:[{x:-6.4,z:2.9},{x:-3.15,z:2.35},{x:-3.4,z:-1.7},{x:-6.7,z:-2.55},{x:-7.8,z:.45}]},
] as const;
export function insidePolygon(p:Point,points:readonly Point[]){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i]!,b=points[j]!;if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
export function terraceHeight(x:number,z:number){return burialTerraces.find(t=>insidePolygon({x,z},t.points))?.height??0;}
export const clearing={x:0,z:.25,radiusX:2.55,radiusZ:3.0};
export type PavingIsland={x:number;z:number;width:number;length:number;angle:number;opacity:number};
export const pavingIslands:readonly PavingIsland[]=[
 {x:-3.3,z:7.0,width:1.05,length:1.25,angle:.04,opacity:.86},
 {x:-3.05,z:5.9,width:1.05,length:.9,angle:.20,opacity:.80},
 {x:-2.6,z:4.85,width:1.12,length:1.08,angle:.36,opacity:.76},
 {x:-1.9,z:3.8,width:1.18,length:1.05,angle:.54,opacity:.68},
 {x:-1.05,z:2.7,width:1.18,length:1.18,angle:.35,opacity:.55},
 {x:-.35,z:1.65,width:1.05,length:.95,angle:.12,opacity:.24},
 {x:.15,z:-1.75,width:1.18,length:.98,angle:-.08,opacity:.28},
 {x:.05,z:-2.9,width:1.32,length:1.2,angle:-.12,opacity:.58},
 {x:-.06,z:-4.05,width:1.55,length:1.16,angle:.06,opacity:.78},
 {x:0,z:-4.95,width:2.25,length:.82,angle:0,opacity:.94},
];
// Broken retaining runs register both the painted carriers and their collision edges.
export const retainingStones:readonly SiteWall[]=burialTerraces.flatMap(t=>t.points.flatMap((a,i)=>{
 const b=t.points[(i+1)%t.points.length]!,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),count=Math.ceil(length/.85);
 return Array.from({length:count},(_,j)=>{if((i===1&&j===2)||(i===2&&j===0)||(i===4&&j===1))return undefined;
  const start=(j+(j===0?.28:.06))/count,end=(j+(j===count-1?.72:.94))/count;
  return {id:`${t.id}-stone-${i}-${j}`,from:{x:a.x+dx*start,z:a.z+dz*start},to:{x:a.x+dx*end,z:a.z+dz*end},height:.22+((i*3+j)%4)*.045,thickness:.32,surface:'masonry' as const,assembly:t.id};
 }).filter((w):w is NonNullable<typeof w>=>!!w);
}));
