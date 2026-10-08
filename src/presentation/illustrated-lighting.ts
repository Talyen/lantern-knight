import {registeredTrim} from './animation-blend-shader';
import * as T from 'three';
export function neutralColor(color:T.Color){const v=color.r*.2126+color.g*.7152+color.b*.0722;return color.setRGB(v,v,v);}
import {right,up,outward,contract} from '../core/camera';
import type {ActorSprite} from './sprite';
import {registeredSword,rigidSwordGLSL} from './rigid-sword';
import {lightingRigs,lookPresets,cameraKeyDirection,type LookSettings} from './lighting-profiles';
type Companion={file:string;hash:string;sourceHash:string;rect:number[];trim:number[];width:number;height:number};
export class NormalLibrary {
 entries:Record<string,Companion>={};textures=new Map<string,T.Texture>();bytes=0;private disposed=false;
 async load(){
  const response=await fetch('/lighting/manifest.json');if(!response.ok)throw new Error('Lighting companions unavailable. Run npm run assets:lighting.');
  const manifest=await response.json();if(manifest.recipe!=='alpha-volume-v1')throw new Error('Lighting companion recipe differs');this.entries=manifest.entries;
  try{await Promise.all(Object.entries(this.entries).map(async([key,entry])=>{
   const r=await fetch('/lighting/'+entry.file);if(!r.ok)throw new Error(`lighting companion unavailable: ${key}`);const bytes=await r.arrayBuffer();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==entry.hash)throw new Error(`lighting companion hash differs: ${key}`);
   const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
   if(bitmap.width!==entry.width||bitmap.height!==entry.height){bitmap.close();throw new Error(`lighting companion size differs: ${key}`);}
   if(this.disposed){bitmap.close();return;}const texture=new T.Texture(bitmap);texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
   this.textures.set(key,texture);this.bytes+=entry.width*entry.height*4;
  }));}catch(error){this.dispose();throw error;}
 }
 get(sprite:ActorSprite,frame=sprite.lightingSample?.frame){if(!frame)return undefined;const key=`${sprite.manifest.asset.id}:${frame.id}`,entry=this.entries[key];if(!entry)return undefined;
  const page=sprite.manifest.pages.find(p=>p.id===frame.page)!;if(entry.sourceHash!==page.hash||entry.rect.join()!==frame.rect.join()||entry.trim.join()!==frame.trim.join())throw new Error(`stale lighting companion: ${key}`);
  return this.textures.get(key);
 }
 dispose(){this.disposed=true;for(const t of this.textures.values()){(t.image as ImageBitmap).close();t.dispose();}this.textures.clear();this.bytes=0;}
}
const shader=`
${rigidSwordGLSL}
varying vec3 inkWorld; varying vec3 inkSurface; varying vec2 inkUV;
uniform float inkEnabled,inkStrength,inkAmbient,inkKeyStrength,inkRim,inkHaze,inkIsGround,inkEmissive,inkHasNormal,inkBlend,inkWarp,inkMix,inkMirror,inkFootY,inkBodyHeight,inkShadowEnabled;
uniform vec3 inkSky,inkGround,inkKey,inkDirection,inkFog,inkOrigin;
uniform vec3 inkLightPosition[4]; uniform vec3 inkLightColor[4]; uniform float inkLightPower[4],inkLightRange[4];
uniform sampler2D inkNormalA,inkNormalB,inkFlow;
uniform vec4 inkTrimA,inkTrimB,inkRectA,inkFlowRect;
uniform vec2 inkCanvas;
uniform float inkSwordEnabled,inkSwordWidth,inkSwordRotation;uniform vec4 inkSwordA,inkSwordB;
uniform sampler2DShadow inkShadowMap; uniform mat4 inkShadowMatrix;
float inkVisibility(){
 if(inkShadowEnabled<.5||inkIsGround>.5)return 1.0;
 vec4 q=inkShadowMatrix*vec4(inkWorld+vec3(0.0,.035,0.0),1.0);q.xyz/=q.w;
 if(any(lessThan(q.xyz,vec3(0.0)))||any(greaterThan(q.xyz,vec3(1.0))))return 1.0;
 float result=0.0;
 for(int i=0;i<4;i++){vec2 offset=vec2(float(i%2)*2.0-1.0,float(i/2)*2.0-1.0)*.001;result+=texture(inkShadowMap,vec3(q.xy+offset,q.z-.0012));}
 return result*.25;
}
vec4 inkMotion(vec2 q){vec2 uv=inkFlowRect.xy+clamp(q,0.0,1.0)*inkFlowRect.zw;return (texture2D(inkFlow,vec2(uv.x,1.0-uv.y))*255.0-128.0)*2.0/inkCanvas.xyxy;}
vec3 inkSampleNormal(sampler2D image,vec2 q,vec4 trim){vec2 p=(q-trim.xy)/trim.zw;if(any(lessThan(p,vec2(0.0)))||any(greaterThan(p,vec2(1.0))))return vec3(0.0,0.0,1.0);return normalize(texture2D(image,vec2(p.x,1.0-p.y)).rgb*2.0-1.0);}
vec3 inkNormal(){
 if(inkHasNormal<.5)return normalize(inkSurface);
 vec3 n;
 if(inkBlend>.5){vec2 a=vec2(inkUV.x,1.0-inkUV.y),b=a;if(inkWarp>.5){for(int i=0;i<2;i++){a=vec2(inkUV.x,1.0-inkUV.y)-inkMix*inkMotion(a).xy;b=vec2(inkUV.x,1.0-inkUV.y)-(1.0-inkMix)*inkMotion(b).zw;}}
  float blend=inkMix;
  if(inkSwordEnabled>.5){vec4 rigid=swordCoordinates(vec2(inkUV.x,1.0-inkUV.y)*inkCanvas,inkSwordA,inkSwordB,inkMix,inkSwordRotation);float protect=swordProtection(vec4(a,b)*inkCanvas.xyxy,rigid,inkSwordA,inkSwordB,inkSwordWidth);a=mix(a,rigid.xy/inkCanvas,protect);b=mix(b,rigid.zw/inkCanvas,protect);blend=mix(blend,step(.5,inkMix),protect);}
  n=normalize(mix(inkSampleNormal(inkNormalA,a,inkTrimA),inkSampleNormal(inkNormalB,b,inkTrimB),blend));
 }else{vec2 q=(inkUV-inkRectA.xy)/inkRectA.zw;n=normalize(texture2D(inkNormalA,q).rgb*2.0-1.0);}
 n.x*=inkMirror;return normalize(vec3(${right.x},${right.y},${right.z})*n.x+vec3(${up.x},${up.y},${up.z})*n.y+vec3(${outward.x},${outward.y},${outward.z})*n.z);
}
vec3 inkIlluminate(vec3 base){
 if(inkEnabled<.5)return base;
 if(inkEmissive>.5)return base*2.8;
 vec3 n=inkNormal();float skyWeight=inkIsGround>.5?.85:clamp(.30+.45*(inkWorld.y-inkFootY)/inkBodyHeight+n.y*.15,0.0,1.0);
 vec3 illumination=mix(inkGround,inkSky,skyWeight)*inkAmbient;
 float key=max(0.0,dot(n,inkDirection))*inkVisibility();illumination+=inkKey*(.16+key*.84)*inkKeyStrength;
 // Broad silhouettes supply stylized relief; texture luminance is never treated as height.
 vec3 local=vec3(0.0);
 for(int i=0;i<4;i++){vec3 delta=inkLightPosition[i]-inkWorld;float d=length(delta);float falloff=pow(max(0.0,1.0-d/max(.1,inkLightRange[i])),2.0);local+=inkLightColor[i]*inkLightPower[i]*falloff*(.22+.78*max(0.0,dot(n,normalize(delta+vec3(.0001)))));}
 float value=dot(base,vec3(.2126,.7152,.0722)),inkProtection=smoothstep(.006,.13,value);
 vec3 response=max(vec3(.08),mix(vec3(1.0),clamp(illumination+local,vec3(.28),vec3(2.5)),inkStrength));
 vec3 result=base*response;
 float edge=pow(1.0-max(0.0,dot(n,vec3(${outward.x},${outward.y},${outward.z}))),2.0);
 result+=(inkKey*key*edge*inkRim+local*.09)*inkProtection*inkStrength*(1.0-inkIsGround);
 float distanceFog=smoothstep(7.0,29.0,length((inkWorld-inkOrigin).xz))*inkHaze;
 return min(mix(result,inkFog*.45,distanceFog),vec3(.98));
}
`;
export class IllustratedLighting {
 readonly normals=new NormalLibrary();
 readonly common={inkShadowEnabled:{value:0},inkShadowMap:{value:null as T.DepthTexture|null},inkShadowMatrix:{value:new T.Matrix4()},inkEnabled:{value:0},inkStrength:{value:1},inkAmbient:{value:1},inkKeyStrength:{value:1},inkRim:{value:0},inkHaze:{value:0},inkSky:{value:new T.Color()},inkGround:{value:new T.Color()},inkKey:{value:new T.Color()},inkDirection:{value:new T.Vector3()},inkFog:{value:new T.Color()},inkOrigin:{value:new T.Vector3()},inkLightPosition:{value:Array.from({length:4},()=>new T.Vector3())},inkLightColor:{value:Array.from({length:4},()=>new T.Color(0xffad57))},inkLightRange:{value:[4.8,4.8,4.8,4.8]},inkLightPower:{value:[0,0,0,0]}};
 private attached=new WeakMap<T.MeshBasicMaterial,ReturnType<IllustratedLighting['uniformsFor']>>();
 private uniformsFor(ground:boolean,emissive:boolean){return {...this.common,inkIsGround:{value:ground?1:0},inkEmissive:{value:emissive?1:0},inkFootY:{value:0},inkBodyHeight:{value:1},inkHasNormal:{value:0},inkMirror:{value:1},inkBlend:{value:0},inkWarp:{value:0},inkMix:{value:0},inkNormalA:{value:null as T.Texture|null},inkNormalB:{value:null as T.Texture|null},inkFlow:{value:null as T.Texture|null},inkTrimA:{value:new T.Vector4()},inkTrimB:{value:new T.Vector4()},inkRectA:{value:new T.Vector4()},inkFlowRect:{value:new T.Vector4()},inkCanvas:{value:new T.Vector2(1,1)},inkSwordEnabled:{value:0},inkSwordWidth:{value:22},inkSwordRotation:{value:0},inkSwordA:{value:new T.Vector4()},inkSwordB:{value:new T.Vector4()}};}
 attach(material:T.MeshBasicMaterial,ground=false,emissive=false){
  const held=this.attached.get(material);if(held)return held;
  const uniforms=this.uniformsFor(ground,emissive);
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(program,renderer)=>{
   previous.call(material,program,renderer);Object.assign(program.uniforms,uniforms);
   program.vertexShader='varying vec3 inkWorld; varying vec3 inkSurface; varying vec2 inkUV;\n'+program.vertexShader;
   program.vertexShader=program.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\ninkWorld=(modelMatrix*vec4(transformed,1.0)).xyz;inkSurface=normalize(mat3(modelMatrix)*normal);inkUV=uv;');
   program.fragmentShader=shader+program.fragmentShader;
   program.fragmentShader=program.fragmentShader.replace('#include <opaque_fragment>','outgoingLight=inkIlluminate(outgoingLight);\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey=()=>`${key}:illustrated-lighting-v2`;material.needsUpdate=true;this.attached.set(material,uniforms);return uniforms;
 }
 sprite(sprite:ActorSprite){
  const sample=sprite.lightingSample;if(!sample)return;
  for(const material of [sprite.material,sprite.edgeMaterial])if(material){
   const u=this.attach(material,false,!!sprite.mesh.userData.emissive),a=this.normals.get(sprite),b=sample.next?this.normals.get(sprite,sample.next):a;
   u.inkFootY.value=sprite.mesh.position.y;u.inkBodyHeight.value=Math.max(.1,sample.frame.trim[3]/(sample.frame.registration??sprite.manifest.asset).density*Math.abs(sprite.mesh.scale.y));u.inkMirror.value=sprite.mesh.scale.x<0?-1:1;u.inkHasNormal.value=a?1:0;if(!a)continue;u.inkNormalA.value=a;u.inkNormalB.value=b??a;
   const frame=sample.frame,page=sprite.manifest.pages.find(p=>p.id===frame.page)!,[x,y,w,h]=frame.rect;
   u.inkRectA.value.set(x/page.width,1-(y+h)/page.height,w/page.width,h/page.height);
   const pair=sample.blend?.motion?sample.flow?.pairs.find(p=>p.asset===sprite.manifest.asset.id&&p.from===frame.id&&p.to===sample.next?.id):undefined;
   const domain=pair??frame.registration??sprite.manifest.asset,[cw,ch]=domain.canvas;u.inkCanvas.value.set(cw,ch);u.inkBlend.value=sample.blend?1:0;u.inkMix.value=sample.blend?.mix??0;
   for(const [f,target]of [[frame,u.inkTrimA],[sample.next??frame,u.inkTrimB]] as const){const t=registeredTrim(sprite.manifest,f,domain,sprite.stabilized);target.value.set(t[0]/cw,t[1]/ch,t[2]/cw,t[3]/ch);}
   u.inkSwordEnabled.value=sample.blend?.guarded&&sprite.rigidSword&&pair?.sword?1:0;
   if(pair?.sword){const sword=registeredSword(pair.sword,{...frame,visualOffsetPx:[...pair.offsetA]},{...(sample.next??frame),visualOffsetPx:[...pair.offsetB]},sprite.stabilized);u.inkSwordA.value.fromArray(sword.a);u.inkSwordB.value.fromArray(sword.b);u.inkSwordWidth.value=sword.width;u.inkSwordRotation.value=sword.rotationRad;}
   u.inkWarp.value=pair?1:0;u.inkFlow.value=sample.flow?.texture??a;
   if(pair&&sample.flow){const [px,py,pw,ph]=(sample.blend!.guarded?(sprite.stabilized?pair.guardedRect:pair.rawGuardedRect):(sprite.stabilized?pair.rect:pair.rawRect)) as [number,number,number,number];u.inkFlowRect.value.set((px+.5)/sample.flow.width,(py+.5)/sample.flow.height,(pw-1)/sample.flow.width,(ph-1)/sample.flow.height);}
  }
 }
 configure(settings:LookSettings,origin:T.Vector3,interior=false){const rig=lightingRigs[settings.rig],look=lookPresets[settings.look],u=this.common;
  u.inkEnabled.value=!settings.baseline&&settings.lighting?1:0;u.inkStrength.value=settings.strength;u.inkSky.value.set(rig.sky);u.inkGround.value.set(rig.ground);u.inkKey.value.set(rig.key);u.inkFog.value.set(rig.fog);u.inkDirection.value.fromArray(cameraKeyDirection(contract.azimuthDeg,rig.elevation,rig.side));u.inkOrigin.value.copy(origin);u.inkAmbient.value=rig.ambient*(settings.look==='cinematic'?.80:1);u.inkKeyStrength.value=rig.keyStrength;u.inkRim.value=look.rim;u.inkHaze.value=settings.atmosphere?look.haze*.5:0;
  if(interior){u.inkAmbient.value*=1.08;u.inkKeyStrength.value*=.18;u.inkKey.value.set(0xb8cbdc);u.inkSky.value.set(0xc3d2dc);u.inkGround.value.set(0x9eafb9);u.inkHaze.value=0;}
 }
 neutralPalette(){const u=this.common;for(const c of [u.inkSky.value,u.inkGround.value,u.inkKey.value,u.inkFog.value,...u.inkLightColor.value])neutralColor(c);}
 restoreLightColors(){for(const c of this.common.inkLightColor.value)c.set(0xffad57);}
 dispose(){this.normals.dispose();}
}
