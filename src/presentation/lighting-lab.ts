import * as T from 'three';
import {EffectComposer,RenderPass,EffectPass,BloomEffect,ToneMappingEffect,ToneMappingMode,SMAAEffect,SMAAPreset,Effect,BlendFunction,EffectAttribute,EdgeDetectionMode,PredicationMode} from 'postprocessing';
import {IllustratedLighting} from './illustrated-lighting';
import {GroundMist} from './ground-mist';
import {defaultLook,lightingRigs,lookPresets,type LookSettings} from './lighting-profiles';
import {neutralColor} from './illustrated-lighting';
import {SurfaceRelief} from './surface-relief';
import {FoliageWind} from './foliage-wind';
import {ActorSprite} from './sprite';
import {attachRevealMask} from './scenery-reveal';
import {AnimationBlendShader} from './animation-blend-shader';
import {worldVisuals} from '../content/world-art';
import {sceneryRegistration} from '../content/scenery-registration';
import {heightAt,type ActorId} from '../content/world';
import type {Simulation} from '../core/simulation';
import type {GamePresentation} from './game-scene';

const finishShader=`
uniform float lookContrast,lookSaturation,lookDefocus,lookFocus,lookNear,lookFar;
uniform vec2 lookTexel; uniform sampler2D lookMask;
void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){
 vec3 color=inputColor.rgb;
 if(lookDefocus>.01){
  vec2 d=lookTexel*3.0;vec4 mask=texture2D(lookMask,uv);float protect=mask.g;
  protect=max(protect,texture2D(lookMask,uv+d).g);protect=max(protect,texture2D(lookMask,uv-d).g);
  protect=max(protect,texture2D(lookMask,uv+vec2(d.x,-d.y)).g);protect=max(protect,texture2D(lookMask,uv+vec2(-d.x,d.y)).g);
  float depth=mix(lookNear,lookFar,mask.r),blur=smoothstep(3.0,11.0,abs(depth-lookFocus))*lookDefocus*(1.0-protect);
  vec3 blurred=vec3(0.0);float total=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
   vec2 p=uv+vec2(float(x),float(y))*d;vec4 neighbor=texture2D(lookMask,p);
   float weight=(1.0-neighbor.g)*step(abs(neighbor.r-mask.r),.035);blurred+=texture2D(inputBuffer,p).rgb*weight;total+=weight;
  }
  if(total>.01)color=mix(color,blurred/total,blur*.8);
 }
 float value=dot(color,vec3(.2126,.7152,.0722));color=mix(vec3(value),color,lookSaturation);
 color=max(vec3(0.0),(color-vec3(.05))*lookContrast+vec3(.05));outputColor=vec4(color,inputColor.a);
}`;
type Caster={mesh:T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>;depth:T.MeshDepthMaterial;blend?:AnimationBlendShader};
type DepthEntry={material:T.MeshBasicMaterial;blend?:AnimationBlendShader};
class ColorAntialiasing extends SMAAEffect {
 constructor(){super({preset:SMAAPreset.HIGH,edgeDetectionMode:EdgeDetectionMode.COLOR,predicationMode:PredicationMode.DISABLED});
  // Color edges without depth predication need no composer depth copy.
  this.setAttributes(EffectAttribute.CONVOLUTION);
 }
}
function targetLedger(root:object){const seen=new Set<object>(),targets:T.WebGLRenderTarget[]=[];function visit(value:unknown,depth:number){if(!value||typeof value!=='object'||seen.has(value)||depth>8)return;seen.add(value);if(value instanceof T.WebGLRenderTarget){targets.push(value);return;}if(value instanceof T.Texture||value instanceof T.Object3D||value instanceof T.WebGLRenderer||ArrayBuffer.isView(value))return;for(const child of Object.values(value))visit(child,depth+1);}visit(root,0);return targets.map(t=>({width:t.width,height:t.height,colorBytes:t.width*t.height*(t.texture.type===T.HalfFloatType?8:t.texture.type===T.FloatType?16:4),depthBytes:t.depthBuffer?t.width*t.height*4:0}));}
export class LightingLab {
 settings:LookSettings={...defaultLook};ready=false;time=0;
 readonly lighting=new IllustratedLighting();private surfaces=new SurfaceRelief();
 private composer:EffectComposer;private bloom:BloomEffect;private finish:Effect;private finishPass:EffectPass;private glowPass:EffectPass;private tone:ToneMappingEffect;
 private mask=new T.WebGLRenderTarget(1,1,{minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true});
 private sun=new T.DirectionalLight(0xffffff,1);private extras=new T.Group();private proxies=new T.Group();private actorCasters=new Map<ActorId,Caster>();private depths=new Map<T.Material,DepthEntry>();
 private floorReceivers:T.Mesh[]=[];private owned:{dispose:()=>void}[]=[];private dust:T.Points;private mist=new GroundMist();private glows:T.Mesh[]=[];
 private generation=-1;private normalReady:Promise<void>;private size=new T.Vector2();private shadowWasEnabled:boolean;private priorAutoClear:boolean;private shadowType:T.ShadowMapType;
 private frameCost={cpuSubmissionMs:0,gpuMs:null as number|null,calls:0,triangles:0};private gl:WebGL2RenderingContext;private timer:{TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}|null;private queries:WebGLQuery[]=[];
 private uniforms={lookContrast:new T.Uniform(1),lookSaturation:new T.Uniform(1),lookDefocus:new T.Uniform(0),lookFocus:new T.Uniform(30),lookNear:new T.Uniform(.1),lookFar:new T.Uniform(100),lookTexel:new T.Uniform(new T.Vector2(1,1)),lookMask:new T.Uniform<T.Texture|null>(null)};
 constructor(private presentation:GamePresentation){
  const {renderer,scene,camera}=presentation;this.priorAutoClear=renderer.autoClear;this.shadowWasEnabled=renderer.shadowMap.enabled;this.shadowType=renderer.shadowMap.type;
  this.gl=renderer.getContext() as WebGL2RenderingContext;this.timer=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  this.composer=new EffectComposer(renderer,{frameBufferType:T.HalfFloatType});this.composer.addPass(new RenderPass(scene,camera));
  this.bloom=new BloomEffect({intensity:.25,luminanceThreshold:1,luminanceSmoothing:.12,mipmapBlur:true,resolutionScale:.5});
  this.glowPass=new EffectPass(camera,this.bloom);this.composer.addPass(this.glowPass);
  this.finish=new Effect('IllustratedFinish',finishShader,{blendFunction:BlendFunction.NORMAL,uniforms:new Map(Object.entries(this.uniforms))});
  this.tone=new ToneMappingEffect({mode:ToneMappingMode.NEUTRAL});this.finishPass=new EffectPass(camera,this.finish,this.tone);this.composer.addPass(this.finishPass);this.composer.addPass(new EffectPass(camera,new ColorAntialiasing()));
  renderer.autoClear=this.priorAutoClear;
  this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.00025;this.sun.shadow.normalBias=.025;this.sun.shadow.radius=4;this.sun.shadow.camera.near=.1;this.sun.shadow.camera.far=75;this.sun.intensity=0;
  const fallback=new T.DepthTexture(1,1,T.UnsignedIntType);fallback.compareFunction=T.LessEqualCompare;fallback.needsUpdate=true;this.owned.push(fallback);
  Object.defineProperty(this.lighting.common.inkShadowMap,'value',{get:()=>this.sun.shadow.map?.depthTexture??fallback});this.lighting.common.inkShadowMatrix.value=this.sun.shadow.matrix;
  scene.add(this.sun,this.sun.target,this.extras,this.proxies);this.extras.visible=this.proxies.visible=false;this.sun.castShadow=false;
  const positions:number[]=[];for(let i=0;i<100;i++)positions.push(Math.sin(i*12.9898)*17,.2+(i%13)/7,Math.cos(i*4.1414)*17);
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  const particle=new T.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,uniforms:{t:{value:0},tint:{value:new T.Color(0xffd7a0)}},vertexShader:'uniform float t;void main(){vec3 p=position;p.x+=sin(t*.25+position.z)*.18;p.y+=sin(t*.16+position.x)*.12;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=2.0;}',fragmentShader:'uniform vec3 tint;void main(){float a=1.0-smoothstep(.05,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(tint,a*.32);#include <colorspace_fragment>\n}'});
  // Includes must start on their own line for the shader preprocessor.
  particle.fragmentShader=particle.fragmentShader.replace(';#include',';\n#include');this.dust=new T.Points(geometry,particle);this.extras.add(this.dust);this.owned.push(geometry,particle);
  const mistTexture=this.radialTexture();this.owned.push(mistTexture);
  this.extras.add(this.mist.group);
  for(let i=0;i<4;i++){const material=new T.MeshBasicMaterial({map:mistTexture,color:new T.Color(0xffac4d).multiplyScalar(4),transparent:true,depthWrite:false,toneMapped:false,blending:T.AdditiveBlending,opacity:.5});const glow=new T.Mesh(new T.PlaneGeometry(.45,.45),material);this.extras.add(glow);this.glows.push(glow);this.owned.push(glow.geometry,material);}
  this.normalReady=Promise.all([this.lighting.normals.load(),this.surfaces.load(presentation.packs)]).then(()=>{this.ready=true;});
 }
 async prepare(){await this.normalReady;}
 private radialTexture(){const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d')!,gradient=ctx.createRadialGradient(32,32,1,32,32,32);gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(.35,'rgba(255,255,255,.35)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);const t=new T.CanvasTexture(canvas);t.generateMipmaps=false;return t;}
 private resetGpuTiming(){for(const query of this.queries)this.gl.deleteQuery(query);this.queries=[];this.frameCost.gpuMs=null;}
 setSettings(settings:Partial<LookSettings>){this.settings={...this.settings,...settings,strength:Math.max(0,Math.min(2,settings.strength??this.settings.strength)),depthOfField:Math.max(0,Math.min(1,settings.depthOfField??this.settings.depthOfField))};}
 deactivate(){this.lighting.common.inkEnabled.value=0;this.extras.visible=this.proxies.visible=false;for(const mesh of this.floorReceivers)mesh.visible=false;this.sun.castShadow=false;const r=this.presentation.renderer;r.shadowMap.enabled=this.shadowWasEnabled;r.shadowMap.type=this.shadowType;r.autoClear=this.priorAutoClear;}
 resetRoom(){this.surfaces.reset();this.resetGpuTiming();for(const receiver of this.floorReceivers){receiver.geometry.dispose();(receiver.material as T.Material).dispose();receiver.removeFromParent();}this.floorReceivers=[];
  this.proxies.traverse(o=>{if(o instanceof T.Mesh){if(!o.userData.sharedGeometry&&!this.actorCasters.has(o.userData.actor))o.geometry.dispose();(o.material as T.Material).dispose();o.customDepthMaterial?.dispose();}});this.proxies.clear();this.actorCasters.clear();for(const entry of this.depths.values())entry.material.dispose();this.depths.clear();this.generation=-1;
 }
 private buildRoom(sim:Simulation){const p=this.presentation;
  this.mist.setArea(sim.areaDefinition);
  const spriteGeometries=new Set([...(p.inkRoom?.sprites??[]),...[...p.actors.values()].map(v=>v.sprite)].map(s=>s.geometry));
  p.room.traverse(o=>{if(o instanceof T.Mesh&&!spriteGeometries.has(o.geometry)&&o.geometry.getAttribute('normal')){
   const materials=Array.isArray(o.material)?o.material:[o.material],ground=o.renderOrder<=-1.7;
   for(const material of materials)if(material instanceof T.MeshBasicMaterial&&(!material.transparent||o.userData.stableReveal)&&material.map){this.lighting.attach(material,ground);if(ground&&worldVisuals[sim.area])this.surfaces.attach(material,worldVisuals[sim.area]!);}
   if(!ground){if(materials.some(m=>!m.transparent)&&!o.userData.noCastShadow)o.castShadow=true;return;}
   if(!materials.some(m=>m instanceof T.MeshBasicMaterial&&!m.transparent&&m.map))return;
   const receiver=new T.Mesh(o.geometry.clone(),new T.ShadowMaterial({opacity:.3,depthWrite:false,color:0x182238}));receiver.position.copy(o.position);receiver.quaternion.copy(o.quaternion);receiver.scale.copy(o.scale);receiver.position.y+=.024;receiver.renderOrder=-1.6;receiver.receiveShadow=true;p.room.add(receiver);this.floorReceivers.push(receiver);
  }});
  for(const prop of worldVisuals[sim.area]?.props??[]){if(prop.shadow==='none'||prop.shadow==='contact'||prop.light||prop.wallFace||prop.clip==='lantern'||prop.clip==='stairs'||prop.clip==='fern'||prop.clip==='rubble')continue;const registration=sceneryRegistration.find(r=>r.id===prop.clip),h=(registration?.height??1)*(prop.scale??1),size=prop.footprint??[Math.min(1.5,h*.35),Math.min(1.5,h*.35)];
   const sprite=p.inkRoom?.sprites.find(s=>s.id===prop.id);
   if(sprite){
    const material=new T.MeshBasicMaterial({map:sprite.material.map,alphaTest:.8,side:T.DoubleSide,colorWrite:false,depthWrite:false});const mesh=new T.Mesh(sprite.geometry,material);mesh.position.copy(sprite.mesh.position);mesh.quaternion.copy(sprite.mesh.quaternion);mesh.scale.copy(sprite.mesh.scale);mesh.userData.sharedGeometry=true;this.shadowOnly(mesh);const wind=sprite.material.userData.foliageWind as FoliageWind|undefined;if(wind){const depth=new T.MeshDepthMaterial({map:sprite.material.map,alphaTest:.8,side:T.DoubleSide,depthPacking:T.RGBADepthPacking});wind.attach(depth);mesh.customDepthMaterial=depth;}this.proxies.add(mesh);continue;
   }
   const geometry=prop.clip.includes('tree')||prop.clip==='yew'?new T.CylinderGeometry(size[0]*.8,size[0]*.3,h,7):new T.BoxGeometry(size[0],h,size[1]);
   const material=new T.MeshBasicMaterial({colorWrite:false,depthWrite:false});const mesh=new T.Mesh(geometry,material);mesh.position.set(prop.x,heightAt(sim.areaDefinition,prop.x,prop.z)+h/2,prop.z);this.shadowOnly(mesh);this.proxies.add(mesh);
  }
  this.generation=sim.generation;
 }
 private shadowOnly(mesh:T.Mesh){
  // Three r186 exposes per-object frustum tests. Only the sun's frustum may draw
  // these casters: colorWrite:false alone would still rasterize them in the beauty pass.
  mesh.castShadow=true;mesh.frustumCulled=true;mesh.intersectsFrustum=frustum=>frustum===this.sun.shadow.getFrustum()&&T.Mesh.prototype.intersectsFrustum.call(mesh,frustum);
 }
 private caster(id:ActorId,sprite:ActorSprite){let entry=this.actorCasters.get(id);if(!entry){const material=new T.MeshBasicMaterial({colorWrite:false,depthWrite:false,alphaTest:.35,side:T.DoubleSide}),depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,alphaTest:.35,side:T.DoubleSide});const mesh=new T.Mesh(sprite.geometry,material);mesh.customDepthMaterial=depth;this.shadowOnly(mesh);mesh.userData.actor=id;entry={mesh,depth};this.actorCasters.set(id,entry);this.proxies.add(mesh);}
  entry.mesh.position.copy(sprite.mesh.position);entry.mesh.quaternion.copy(sprite.mesh.quaternion);entry.mesh.scale.copy(sprite.mesh.scale);entry.mesh.visible=sprite.mesh.visible;if(!entry.mesh.material.map){entry.mesh.material.needsUpdate=true;entry.depth.needsUpdate=true;}entry.mesh.material.map=sprite.material.map;entry.depth.map=sprite.material.map;
  const s=sprite.lightingSample;if(s?.blend&&s.next){entry.blend??=new AnimationBlendShader([entry.depth as unknown as T.MeshBasicMaterial]);entry.blend.update(s.blend,sprite.manifest,s.frame,s.next,sprite.textures,s.flow,sprite.stabilized,sprite.rigidSword);}else if(entry.blend)entry.blend.uniforms.walkEnabled.value=0;
 }
 private depthMaterial(source:T.Material,sprite?:ActorSprite){let entry=this.depths.get(source);
    if(!entry){const material=new T.MeshBasicMaterial({alphaTest:sprite?1/255:source instanceof T.MeshBasicMaterial?Math.max(source.map&&source.transparent?1/255:0,source.alphaTest):0,depthWrite:true,depthTest:true,side:source.side,toneMapped:false});const protect=sprite?.manifest.asset.type==='character'||(sprite?.manifest.asset.type==='effect'&&!sprite.mesh.userData.decorative)?1:0;
     material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,{focusNear:this.uniforms.lookNear,focusFar:this.uniforms.lookFar});shader.vertexShader='varying float focusDepth;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nfocusDepth=-mvPosition.z;');shader.fragmentShader='varying float focusDepth; uniform float focusNear,focusFar;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight=vec3(clamp((focusDepth-focusNear)/(focusFar-focusNear),0.,1.),${protect.toFixed(1)},0.0);\n#include <opaque_fragment>`);};material.customProgramCacheKey=()=>`focus-mask-${protect}`;attachRevealMask(material,source);entry={material};this.depths.set(source,entry);
    }
    const wind=source.userData.foliageWind as FoliageWind|undefined;if(wind)wind.attach(entry.material);entry.material.depthTest=source.depthTest;entry.material.map=source instanceof T.MeshBasicMaterial?source.map:null;entry.material.opacity=source.opacity;
    const s=sprite?.lightingSample;if(s?.blend&&s.next){entry.blend??=new AnimationBlendShader([entry.material]);entry.blend.update(s.blend,sprite!.manifest,s.frame,s.next,sprite!.textures,s.flow,sprite!.stabilized,sprite!.rigidSword);}else if(entry.blend)entry.blend.uniforms.walkEnabled.value=0;
  return entry.material;
 }
 private depthMask(sprites:ActorSprite[]){const p=this.presentation,renderer=p.renderer,restore:{mesh:T.Mesh;material:T.Material|T.Material[]}[]=[],byMaterial=new Map<T.Material,ActorSprite>(),edges=new Set(sprites.flatMap(s=>s.edgeMesh?[s.edgeMesh]:[]));
  for(const s of sprites){byMaterial.set(s.material,s);if(s.edgeMaterial)byMaterial.set(s.edgeMaterial,s);}
  const previousTarget=renderer.getRenderTarget(),clear=renderer.getClearColor(new T.Color()),clearAlpha=renderer.getClearAlpha(),previousShadow=renderer.shadowMap.enabled;const extras=this.extras.visible,proxies=this.proxies.visible;
  try{this.extras.visible=this.proxies.visible=false;renderer.shadowMap.enabled=false;
   p.scene.traverseVisible(o=>{if(!(o instanceof T.Mesh)||edges.has(o))return;
    const materials=Array.isArray(o.material)?o.material:[o.material];if(materials.every(m=>m instanceof T.ShadowMaterial))return;
    const sprite=byMaterial.get(materials[0]!);
    // A faded foreground prop must not hide the focus protection of a visible actor.
    if(o.userData.decorative||sprite?.mesh.userData.decorative||(materials[0]!.opacity<.99&&sprite?.manifest.asset.type!=='character'&&sprite?.manifest.asset.type!=='effect')){edges.add(o);return;}
    restore.push({mesh:o,material:o.material});o.material=Array.isArray(o.material)?materials.map(m=>this.depthMaterial(m,byMaterial.get(m))):this.depthMaterial(materials[0]!,sprite);
   });
   // One alpha-tested core includes the entire soft edge in this auxiliary pass.
   // Hide its duplicate beauty edge mesh while retaining all original visibility states.
   const visible=[...edges].map(mesh=>[mesh,mesh.visible] as const);try{for(const [mesh]of visible)mesh.visible=false;renderer.setRenderTarget(this.mask);renderer.setClearColor(0xff0000,1);renderer.clear();renderer.render(p.scene,p.camera);}finally{for(const [mesh,wasVisible]of visible)mesh.visible=wasVisible;}
  }finally{for(const r of restore)r.mesh.material=r.material;renderer.setRenderTarget(previousTarget);renderer.setClearColor(clear,clearAlpha);renderer.shadowMap.enabled=previousShadow;this.extras.visible=extras;this.proxies.visible=proxies;}
 }
 render(sim:Simulation,ms:number){const r=this.presentation.renderer,start=performance.now(),autoReset=r.info.autoReset;let query:WebGLQuery|null=null;
  if(this.timer){const gl=this.gl,disjoint=gl.getParameter(this.timer.GPU_DISJOINT_EXT);while(this.queries.length&&gl.getQueryParameter(this.queries[0]!,gl.QUERY_RESULT_AVAILABLE)){const q=this.queries.shift()!;if(!disjoint)this.frameCost.gpuMs=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);}if(this.queries.length<3){query=gl.createQuery();if(query)gl.beginQuery(this.timer.TIME_ELAPSED_EXT,query);}}
  r.info.reset();r.info.autoReset=false;try{this.draw(sim,ms);}finally{if(query){this.gl.endQuery(this.timer!.TIME_ELAPSED_EXT);this.queries.push(query);}this.frameCost.cpuSubmissionMs=performance.now()-start;this.frameCost.calls=r.info.render.calls;this.frameCost.triangles=r.info.render.triangles;r.info.autoReset=autoReset;}
 }
 private draw(sim:Simulation,ms:number){const p=this.presentation,r=p.renderer,s=this.settings,fx=p.visualEffects;if(!this.ready)throw new Error('lighting lab is still preparing');
  if(s.baseline){this.deactivate();r.render(p.scene,p.camera);return;}
  if(this.generation!==sim.generation){this.resetRoom();this.buildRoom(sim);}
  this.surfaces.update(fx);this.time+=ms/1000;const rig=lightingRigs[s.rig],look=lookPresets[s.look],origin=p.cameraTarget;
  this.lighting.configure(s,origin,!!worldVisuals[sim.area]?.interior);if(worldVisuals[sim.area]?.interior||!fx.atmosphere)this.lighting.common.inkHaze.value=0;this.lighting.common.inkShadowEnabled.value=s.shadows?1:0;const sprites=[...(p.inkRoom?.sprites??[]),...[...p.actors.values()].map(v=>v.sprite)];for(const sprite of sprites){this.lighting.sprite(sprite);if(!fx.surfaceDepth)for(const m of [sprite.material,sprite.edgeMaterial])if(m)this.lighting.attach(m).inkHasNormal.value=0;}this.lighting.restoreLightColors();if(!fx.palette)this.lighting.neutralPalette();
  const lights=this.lighting.common;lights.inkLightPower.value.fill(0);lights.inkLightPosition.value[0]!.set(sim.hero.x-.25,sim.hero.y+.85,sim.hero.z);lights.inkLightPower.value[0]=sim.hero.state==='ability'?2.9:1.15;
  lights.inkLightRange.value.fill(4.8);
  for(const [i,l]of p.sceneEffects.lights(fx).slice(0,3).entries()){lights.inkLightPosition.value[i+1]!.copy(l.position);lights.inkLightPower.value[i+1]=l.power;lights.inkLightRange.value[i+1]=l.range;}
  r.shadowMap.enabled=s.shadows;r.shadowMap.type=T.PCFShadowMap;this.sun.castShadow=s.shadows;this.proxies.visible=s.shadows;for(const receiver of this.floorReceivers){receiver.visible=s.shadows;const material=receiver.material as T.ShadowMaterial;material.opacity=look.shadow;material.color.set(s.rig==='golden'?0x454451:0x293243);if(!fx.palette)neutralColor(material.color);}
  const shadowOrigin=worldVisuals[sim.area]?.interior||sim.area==='court'?new T.Vector3(0,heightAt(sim.areaDefinition,0,0),0):origin;
  this.sun.target.position.copy(shadowOrigin);this.sun.position.copy(shadowOrigin).addScaledVector(lights.inkDirection.value,32);this.sun.target.updateMatrixWorld();this.sun.position.y=Math.max(this.sun.position.y,8);
  const span=sim.area==='court'?22:Math.max(15,p.viewSpan*1.25),shadow=this.sun.shadow.camera;shadow.left=shadow.bottom=-span;shadow.right=shadow.top=span;shadow.updateProjectionMatrix();
  for(const [id,v]of p.actors)this.caster(id,v.sprite);
  this.extras.visible=s.atmosphere||s.lighting;this.dust.visible=fx.atmosphere&&s.atmosphere&&!worldVisuals[sim.area]?.interior;(this.dust.material as T.ShaderMaterial).uniforms.t!.value=this.time;(this.dust.material as T.ShaderMaterial).uniforms.tint!.value.set(s.rig==='golden'?0xffd7a0:0xc5d7ed);
  this.mist.group.visible=fx.atmosphere&&s.atmosphere&&!worldVisuals[sim.area]?.interior;this.mist.update(this.time,rig.fog,look.mist*.8,sim.area==='court'?new T.Vector3(0,0,0):origin);
  this.glows.forEach((mesh,i)=>{mesh.visible=s.lighting&&lights.inkLightPower.value[i]!>0;mesh.position.copy(lights.inkLightPosition.value[i]!);mesh.quaternion.copy(p.camera.quaternion);mesh.scale.setScalar(i===0&&sim.hero.state==='ability'?2.7:worldVisuals[sim.area]?.interior?.5:1);});
  if(!s.postprocessing){r.autoClear=this.priorAutoClear;r.render(p.scene,p.camera);return;}
  this.resize();
  this.glowPass.enabled=fx.bloom;this.bloom.intensity=fx.bloom?look.bloom:0;this.uniforms.lookContrast.value=look.contrast;this.uniforms.lookSaturation.value=look.saturation;this.uniforms.lookDefocus.value=(look.defocus||1)*s.depthOfField;this.uniforms.lookNear.value=p.camera.near;this.uniforms.lookFar.value=p.camera.far;this.uniforms.lookFocus.value=p.camera.position.clone().sub(origin.clone().add(new T.Vector3(0,.8,0))).dot(new T.Vector3(0,0,1).applyQuaternion(p.camera.quaternion));
  if(this.uniforms.lookDefocus.value>0)this.depthMask(sprites);r.autoClear=false;this.composer.render(ms/1000);
 }
 resize(){const r=this.presentation.renderer,size=r.getDrawingBufferSize(new T.Vector2());if(size.equals(this.size))return;this.size.copy(size);const logical=r.getSize(new T.Vector2());this.composer.setSize(logical.x,logical.y);this.mask.setSize(size.x,size.y);this.uniforms.lookMask.value=this.mask.texture;this.uniforms.lookTexel.value.set(1/size.x,1/size.y).multiplyScalar(size.y/1440);}
 focusMaskStats(){const pixels=new Uint8Array(this.mask.width*this.mask.height*4);this.presentation.renderer.readRenderTargetPixels(this.mask,0,0,this.mask.width,this.mask.height,pixels);let protectedPixels=0,groundPixels=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+1]!>128)protectedPixels++;else if(pixels[i]!<254)groundPixels++;}return{protectedPixels,groundPixels,width:this.mask.width,height:this.mask.height};}
 stats(){const w=this.size.x,h=this.size.y,main=w*h*8*2,mask=this.mask.width*this.mask.height*8,ledger=targetLedger(this.composer),targetsBytes=ledger.reduce((s,t)=>s+t.colorBytes+t.depthBytes,0);return{ready:this.ready,antiAliasing:{method:'SMAA 1x',preset:'High',edgeDetection:'color'},...this.settings,time:this.time,companions:this.lighting.normals.textures.size,normalBytes:this.lighting.normals.bytes,frameCost:{...this.frameCost,gpuTiming:this.timer?'available':'unavailable'},targets:{width:w,height:h,colorBytes:main,focusColorAndDepthBytes:mask,shadowBytes:2048*2048*8,composerEstimatedBytes:targetsBytes,ledger},casters:this.proxies.children.length};}
 dispose(){this.deactivate();this.resetRoom();this.composer.dispose();this.mask.dispose();this.sun.shadow.dispose();this.sun.removeFromParent();this.sun.target.removeFromParent();this.extras.removeFromParent();this.proxies.removeFromParent();this.mist.dispose();for(const owned of this.owned)owned.dispose();for(const query of this.queries)this.gl.deleteQuery(query);this.queries=[];this.surfaces.dispose();this.lighting.dispose();}
}
