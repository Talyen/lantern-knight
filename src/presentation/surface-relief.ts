import * as T from 'three';
import type {PackLease} from '../assets/loader';
import type {WorldVisualDefinition} from '../content/world-art';
import type {VisualEffects} from '../content/visual-effects';
import {outward} from '../core/camera';
type SurfaceSource={asset:string;frame:string;pageHash:string};
/** Companions describe traced structure, and never modify the original paintings. */
export class SurfaceRelief {
 private textures=new Map<string,T.Texture>();private sources=new Map<string,SurfaceSource>();private packs?:Map<string,PackLease>;
 private bindings:{normal:T.Uniform<number>;relief:T.Uniform<number>}[]=[];private disposed=false;
 async load(packs:Map<string,PackLease>){this.packs=packs;const response=await fetch('/visual-effects/surfaces.json');if(!response.ok)throw new Error('Surface companions unavailable');const data=await response.json();if(data.recipe!=='hand-authored-stone-height-v1')throw new Error('Surface companion recipe differs');
  await Promise.all(Object.entries(data.entries).map(async([id,entry])=>{const e=entry as SurfaceSource&{file:string;hash:string;width:number;height:number};this.sources.set(id,e);this.validate(id);const r=await fetch('/visual-effects/'+e.file);if(!r.ok)throw new Error(`missing surface: ${id}`);const bytes=await r.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!==e.hash)throw new Error(`surface hash differs: ${id}`);const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});if(bitmap.width!==e.width||bitmap.height!==e.height){bitmap.close();throw new Error('surface dimensions differ');}if(this.disposed){bitmap.close();return;}const t=new T.Texture(bitmap);t.flipY=false;t.wrapS=t.wrapT=T.RepeatWrapping;t.generateMipmaps=true;t.minFilter=T.LinearMipmapLinearFilter;t.needsUpdate=true;this.textures.set(id,t);}));
 }
 private validate(id:string){const source=this.sources.get(id)!,pack=this.packs?.get(source.asset);if(pack){const frame=pack.manifest.frames.find(f=>f.id===source.frame);if(!frame||pack.manifest.pages.find(p=>p.id===frame.page)?.hash!==source.pageHash)throw new Error(`stale surface source: ${id}`);}}
 attach(material:T.MeshBasicMaterial,art:WorldVisualDefinition){if(material.userData.surfaceRelief||!['ink-graveyard-materials','ink-crypt-stone'].includes(art.floor))return;
  const crypt=!!art.interior,key=material.customProgramCacheKey(),blackwood=key.includes('blackwood'),id=crypt?'crypt':blackwood?'apron':'paving',texture=this.textures.get(id);if(!texture)return;this.validate(id);
  const normal=new T.Uniform(0),relief=new T.Uniform(0),previous=material.onBeforeCompile;this.bindings.push({normal,relief});material.userData.surfaceRelief=true;
  material.onBeforeCompile=(shader,renderer)=>{previous.call(material,shader,renderer);
   const marker=crypt?'stone=texture2D(map,vec2(q.x,-q.y)/4.).rgb':blackwood?'texture2D(apronMap,terrainUV).rgb*.80,stone*.72':'texture2D(pavingMap,terrainUV)';if(!shader.fragmentShader.includes(marker))return;
   Object.assign(shader.uniforms,{surfaceCompanion:{value:texture},surfaceNormals:normal,surfaceRelief:relief});shader.fragmentShader=`uniform sampler2D surfaceCompanion;uniform float surfaceNormals,surfaceRelief;float fxSurfaceWeight=0.;
vec2 fxReliefUV(vec2 q){vec2 uv=vec2(q.x,-q.y)/4.;float h=texture2D(surfaceCompanion,uv).a-.5;return uv-vec2(${outward.x},${-outward.z})/${outward.y}*h*.012*surfaceRelief;}
`+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('vec3 n=inkNormal();','vec3 n=inkNormal();if(inkIsGround>.5&&fxSurfaceWeight>0.){vec3 detail=texture2D(surfaceCompanion,fxReliefUV(inkWorld.xz)).rgb*2.-1.;n=normalize(mix(n,vec3(detail.x,detail.z,-detail.y),surfaceNormals*.40*fxSurfaceWeight));}');
   if(crypt){shader.fragmentShader=shader.fragmentShader.replace(marker,'stone=texture2D(map,fxReliefUV(q)).rgb').replace('float baseShade=','fxSurfaceWeight=(1.-side)*(1.-sanctuary);float baseShade=');}
   else if(blackwood){shader.fragmentShader=shader.fragmentShader.replace('color=mix(color,texture2D(apronMap,terrainUV).rgb*.80,stone*.72);','fxSurfaceWeight=stone*.72;color=mix(color,texture2D(apronMap,fxReliefUV(q)).rgb*.80,stone*.72);');}
   else {shader.fragmentShader=shader.fragmentShader.replaceAll(marker,'texture2D(pavingMap,fxReliefUV(q))').replace('stone=max(stone,threshold);','stone=max(stone,threshold);fxSurfaceWeight=stone*(1.-threshold);');}
  };material.customProgramCacheKey=()=>`${key}:surface-relief-v2:${id}`;material.needsUpdate=true;
 }
 update(options:VisualEffects){for(const b of this.bindings){b.normal.value=options.surfaceDepth?1:0;b.relief.value=options.relief?1:0;}}
 reset(){this.bindings=[];}
 dispose(){this.disposed=true;for(const t of this.textures.values()){(t.image as ImageBitmap).close();t.dispose();}this.textures.clear();this.reset();}
}
