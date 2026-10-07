import type {Frame} from '../assets/schema';
export type SwordPair={a:readonly number[];b:readonly number[];width:number};
export function registeredSword(pair:SwordPair,a:Frame,b:Frame,stabilized:boolean){
 const shifted=(points:readonly number[],frame:Frame)=>{const [x,y]=stabilized?frame.visualOffsetPx??[0,0]:[0,0];return [points[0]!+x!,points[1]!+y!,points[2]!+x!,points[3]!+y!] as [number,number,number,number];};
 return {a:shifted(pair.a,a),b:shifted(pair.b,b),width:pair.width};
}
// Shared by color and normal sampling. The blade stays straight; one source
// drawing supplies its paint. Nearby source pixels preserve the hilt/hand overlap.
export const rigidSwordGLSL=`
#ifndef LANTERN_RIGID_SWORD
#define LANTERN_RIGID_SWORD
vec2 swordPerp(vec2 a){return vec2(-a.y,a.x);}
vec4 swordCoordinates(vec2 p,vec4 a,vec4 b,float t){
 vec2 da=a.zw-a.xy,db=b.zw-b.xy;float la=length(da),lb=length(db);vec2 ua=da/la,ub=db/lb;
 float angle=atan(ua.x*ub.y-ua.y*ub.x,dot(ua,ub))*t;
 vec2 axis=vec2(cos(angle)*ua.x-sin(angle)*ua.y,sin(angle)*ua.x+cos(angle)*ua.y);
 vec2 delta=p-mix(a.xy,b.xy,t);float along=dot(delta,axis),across=dot(delta,swordPerp(axis)),len=mix(la,lb,t);
 return vec4(a.xy+ua*(along*la/len)+swordPerp(ua)*across,b.xy+ub*(along*lb/len)+swordPerp(ub)*across);
}
float swordMask(vec2 p,vec4 s,float width){
 vec2 axis=s.zw-s.xy;float t=clamp(dot(p-s.xy,axis)/dot(axis,axis),0.0,1.0);
 float distance=length(p-s.xy-axis*t),radius=mix(width,10.0,t);
 return 1.0-smoothstep(radius-3.0,radius+1.0,distance);
}
float swordProtection(vec4 body,vec4 rigid,vec4 a,vec4 b,float width){
 return max(max(swordMask(body.xy,a,width),swordMask(body.zw,b,width)),max(swordMask(rigid.xy,a,width),swordMask(rigid.zw,b,width)));
}
#endif
`;
