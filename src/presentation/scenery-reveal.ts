import * as T from 'three';
import type {ActorSprite} from './sprite';
import {right,up,contract} from '../core/camera';
export type CoverageMask={width:number;height:number;alpha:number[]};
export function coverageAt(mask:CoverageMask|undefined,u:number,v:number){if(u<0||u>1||v<0||v>1)return 0;if(!mask)return 1;return mask.alpha[Math.min(mask.height-1,Math.floor(v*mask.height))*mask.width+Math.min(mask.width-1,Math.floor(u*mask.width))]!/255;}
type Projection={matrix:T.Matrix4;version:number;ax:number;ay:number;bx:number;by:number;cx:number;cy:number;det:number};
const projections=new WeakMap<ActorSprite,Projection>();
export function cardCoverage(sprite:ActorSprite,point:T.Vector3,mask?:CoverageMask){sprite.mesh.updateWorldMatrix(true,false);const vertices=sprite.geometry.getAttribute('position'),version=vertices instanceof T.BufferAttribute?vertices.version:vertices.data.version;let p=projections.get(sprite);
 if(!p||p.version!==version||!p.matrix.equals(sprite.mesh.matrixWorld)){const a=new T.Vector3().fromBufferAttribute(vertices,0).applyMatrix4(sprite.mesh.matrixWorld),b=new T.Vector3().fromBufferAttribute(vertices,1).applyMatrix4(sprite.mesh.matrixWorld),c=new T.Vector3().fromBufferAttribute(vertices,2).applyMatrix4(sprite.mesh.matrixWorld);const bx=b.clone().sub(a).dot(right),by=b.clone().sub(a).dot(up),cx=c.clone().sub(a).dot(right),cy=c.clone().sub(a).dot(up);p={matrix:sprite.mesh.matrixWorld.clone(),version,ax:a.dot(right),ay:a.dot(up),bx,by,cx,cy,det:bx*cy-by*cx};projections.set(sprite,p);}
 if(Math.abs(p.det)<1e-10)return 0;const dx=point.dot(right)-p.ax,dy=point.dot(up)-p.ay,u=(dx*p.cy-dy*p.cx)/p.det,v=(p.bx*dy-p.by*dx)/p.det;if(u<0||u>1||v<0||v>1)return 0;const q=sprite.mesh.userData.coverageCorners as number[][]|undefined;if(!q)return coverageAt(mask,u,v);const sample=(axis:number)=>((q[0]![axis]!*(1-u)+q[1]![axis]!*u)*(1-v)+(q[2]![axis]!*(1-u)+q[3]![axis]!*u)*v);return coverageAt(mask,sample(0),sample(1));}

export class LocalReveal {
 readonly centers=Array.from({length:contract.budgets.maxActors+1},()=>new T.Vector2(1e5,1e5));readonly strengths=Array.from({length:contract.budgets.maxActors+1},()=>0);readonly sizes=Array.from({length:contract.budgets.maxActors+1},()=>new T.Vector2(.58,.95));
 private count={value:0};private held=Array.from({length:contract.budgets.maxActors+1},()=>0);
 constructor(readonly mesh:T.Mesh,materials:(T.Material|undefined)[]){
  for(const m of materials)if(m){const prior=m.onBeforeCompile,key=m.customProgramCacheKey();m.userData.revealData={centers:this.centers,sizes:this.sizes,strengths:this.strengths,count:this.count};m.transparent=true;m.depthWrite=m===materials[0];m.opacity=1;m.needsUpdate=true;
   m.onBeforeCompile=(shader,renderer)=>{prior.call(m,shader,renderer);Object.assign(shader.uniforms,{revealCenters:{value:this.centers},revealStrengths:{value:this.strengths},revealSizes:{value:this.sizes},revealCount:this.count});
    shader.vertexShader='varying vec2 revealPosition;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>\nvec3 revealWorld=(modelMatrix*vec4(transformed,1.)).xyz;revealPosition=vec2(dot(revealWorld,vec3(${right.x},${right.y},${right.z})),dot(revealWorld,vec3(${up.x},${up.y},${up.z})));`);
    shader.fragmentShader=`varying vec2 revealPosition;uniform vec2 revealCenters[${this.centers.length}],revealSizes[${this.centers.length}];uniform float revealStrengths[${this.centers.length}];uniform int revealCount;\n`+shader.fragmentShader;
    // Both source coverage tests finish before opacity is reduced: core and soft edge remain disjoint.
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float reveal=0.;for(int i=0;i<${this.centers.length};i++){if(i>=revealCount)break;if(revealStrengths[i]<.001)continue;float d=length((revealPosition-revealCenters[i])/revealSizes[i]);reveal=max(reveal,revealStrengths[i]*(1.-smoothstep(.68,1.14,d)));}diffuseColor.a*=1.-reveal*.84;\n#include <opaque_fragment>`);
   };m.customProgramCacheKey=()=>`${key}:local-scenery-reveal-v2`;
  }
  mesh.userData.stableReveal=true;
 }

 update(points:{center:T.Vector2;size:T.Vector2;obscures:boolean}[],ms:number){const dt=Math.max(0,Math.min(ms/1000,.1)),weight=1-Math.exp(-dt/.09);
  this.count.value=Math.min(points.length,this.centers.length);for(let i=0;i<this.centers.length;i++){const point=points[i];if(point){this.centers[i]!.copy(point.center);this.sizes[i]!.copy(point.size);if(point.obscures)this.held[i]=.14;else this.held[i]=Math.max(0,this.held[i]!-dt);}else this.held[i]=0;
   const target=point&&this.held[i]!>0?1:0;this.strengths[i]=Math.abs(this.strengths[i]!-target)<.001?target:this.strengths[i]!+(target-this.strengths[i]!)*weight;
  }
  this.mesh.userData.revealStrength=Math.max(...this.strengths);
 }
}

export class SceneryReveal extends LocalReveal {
 constructor(readonly sprite:ActorSprite){super(sprite.mesh,[sprite.material,sprite.edgeMaterial]);}
}

// Auxiliary focus masks must discard the same local reveal, rather than treating the
// still-opaque material setting as a wall covering the fighter behind it.
export function attachRevealMask(material:T.MeshBasicMaterial,source:T.Material){
 const data=source.userData.revealData as {centers:T.Vector2[];sizes:T.Vector2[];strengths:number[];count:{value:number}}|undefined;if(!data)return;
 const prior=material.onBeforeCompile,key=material.customProgramCacheKey(),length=data.centers.length;
 material.onBeforeCompile=(shader,renderer)=>{prior.call(material,shader,renderer);Object.assign(shader.uniforms,{revealCenters:{value:data.centers},revealSizes:{value:data.sizes},revealStrengths:{value:data.strengths},revealCount:data.count});shader.vertexShader='varying vec2 revealPosition;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>\nvec3 revealWorld=(modelMatrix*vec4(transformed,1.)).xyz;revealPosition=vec2(dot(revealWorld,vec3(${right.x},${right.y},${right.z})),dot(revealWorld,vec3(${up.x},${up.y},${up.z})));`);shader.fragmentShader=`varying vec2 revealPosition;uniform vec2 revealCenters[${length}],revealSizes[${length}];uniform float revealStrengths[${length}];uniform int revealCount;\n`+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`for(int i=0;i<${length};i++){if(i>=revealCount)break;if(revealStrengths[i]<.001)continue;float d=length((revealPosition-revealCenters[i])/revealSizes[i]);if(revealStrengths[i]*(1.-smoothstep(.68,1.14,d))>.05)discard;}\n#include <opaque_fragment>`);};material.customProgramCacheKey=()=>`${key}:local-reveal-mask-v1`;
}
