import type {Point} from './world';
export const chapelLayout={frontZ:-6.15,rearZ:-12.1,width:6.4,wallHeight:3.1,ridgeHeight:4.7,facadeHeight:5.6,foundationHeight:.3,doorWidth:1.6,doorHeight:2.65};
export const burialTerraces=[
 {id:'west-family',height:.55,points:[{x:-6.4,z:3.7},{x:-2.9,z:2.6},{x:-3.2,z:-1.9},{x:-6.65,z:-2.75},{x:-8.2,z:.7}]},
 {id:'east-old',height:.7,points:[{x:3.1,z:3.5},{x:6.8,z:2.4},{x:8.2,z:-1.4},{x:6.65,z:-4.8},{x:3.3,z:-3.1}]},
 {id:'west-memorial',height:.3,points:[{x:-7,z:-3.65},{x:-3.2,z:-3.15},{x:-3.4,z:-5.85},{x:-6.7,z:-6.8}]},
] as const;
export function insidePolygon(p:Point,points:readonly Point[]){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i]!,b=points[j]!;if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
export function terraceHeight(x:number,z:number){return burialTerraces.find(t=>insidePolygon({x,z},t.points))?.height??0;}
export const clearing={x:0,z:.25,radiusX:2.6,radiusZ:3.0};
