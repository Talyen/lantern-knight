import type {PreparedRegistration} from '../assets/registration';
import * as T from 'three';
import {contract,makeCamera,resizeCamera,trimmedBounds,selectDirection,drawingBufferSize,HEADINGS,right,up,outward} from '../core/camera';
import {ActorSprite,setCutoutOpacity} from './sprite';
import {timedWalk,remapWalkTime,type WalkTiming} from '../core/walk-timing';
import type {WalkBlendMode} from '../core/walk-blending';
import type {WalkFlow} from './walk-blend-shader';
import {InkRoom} from './ink-room';
import {worldVisuals,floorUV,compositionPoint} from '../content/world-art';
import {resolveClip} from '../assets/schema';
import {Animator,clipDuration} from '../core/animation';
import type {Manifest,Clip,Frame} from '../assets/schema';
import {attackDefinition,swordCombo,tuning} from '../content/gameplay';
import {content,heightAt,surfaceGradient,type AreaDefinition,type ActorId,PLAYER_ID} from '../content/world';
import {actorVisuals} from '../content/visuals';
import {pageIdentity,type PackLease} from '../assets/loader';
import {EventHub,type AnimationEvent} from '../core/events';
import type {Actor,Simulation} from '../core/simulation';
import {defaultVisualEffects,type VisualEffects,type WeatherState} from '../content/visual-effects';
import {SceneVisualEffects} from './scene-visual-effects';
import {LightingLab} from './lighting-lab';
export type Mode='encounter'|'calibration'|'animation'|'occlusion'|'lighting';
type Visual={sprite:ActorSprite;shadow:T.Mesh<T.CircleGeometry,T.MeshBasicMaterial>;ring:T.Mesh;tag:string;heading:typeof HEADINGS[number]};
const DEPTH_STAGE={ground:-2,groundGrid:-1,world:0} as const;
export class GamePresentation {
 lookRenderer:LightingLab;depthOfField=0;visualEffects=defaultVisualEffects();sceneEffects:SceneVisualEffects;
 renderer:T.WebGLRenderer;camera=makeCamera(16/9);scene=new T.Scene();room=new T.Group();actors=new Map<ActorId,Visual>();mode:Mode='encounter';
 aim:T.Mesh;light=new T.PointLight(0xf7b862,5,5,2);fadeMeshes:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>[]=[];
 roomOwned:{dispose:()=>void}[]=[];debug=false;background='dark';walkBlend:WalkBlendMode='original';walkStabilized=true;walkRigidSword=true;walkTiming:WalkTiming='weighted';walkFlow:WalkFlow|undefined;private flowBitmap:ImageBitmap|undefined;protected disposed=false;
 shadowTexture:T.CanvasTexture;cameraTarget=new T.Vector3();viewTarget=new T.Vector3();requestedRenderScale=contract.renderScale;effectivePixelRatio=1;
 verticalSpan=contract.verticalSpan;area:AreaDefinition=content.area('court');generation=-1;groundNormal=new T.Vector3(0,1,0);planeNormal=new T.Vector3(0,0,1);effectTag='';flare:T.Mesh;slash:T.Mesh;inkRoom:InkRoom|undefined;
 get manifest(){return this.packs.get('ink-hero')!.manifest;}
 get textures(){return this.packs.get('ink-hero')!.textures;}
 constructor(public canvas:HTMLCanvasElement,public packs:Map<string,PackLease>,public events:EventHub,initialArea:AreaDefinition,readonly registration:PreparedRegistration){
    this.area=initialArea;
    this.renderer=new T.WebGLRenderer({canvas,antialias:false,alpha:false});this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.setPixelRatio(contract.pixelRatioCap);this.renderer.setClearColor(0x151923);
    if(this.renderer.capabilities.maxTextureSize<Math.max(...this.manifest.pages.map(p=>Math.max(p.width,p.height))))throw new Error('GPU maximum texture size below compiled atlas dimensions');
    this.scene.add(new T.HemisphereLight(0xc5d4e1,0x392b30,2));const sun=new T.DirectionalLight(0xe9d2ac,2);sun.position.set(-4,8,3);this.scene.add(sun,this.light,this.room);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=64;shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d')!,gradient=ctx.createRadialGradient(32,32,2,32,32,32);gradient.addColorStop(0,'rgba(0,0,0,0.5)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);this.shadowTexture=new T.CanvasTexture(shadowCanvas);this.shadowTexture.generateMipmaps=false;
    this.flare=new T.Mesh(new T.RingGeometry(.02,tuning.ability.range,48,6,-tuning.ability.halfAngle,tuning.ability.halfAngle*2),new T.MeshBasicMaterial({color:0xf4c575,transparent:true,opacity:.35,depthTest:true,depthWrite:false,side:T.DoubleSide}));this.flare.rotation.x=-Math.PI/2;this.flare.frustumCulled=false;
    this.slash=new T.Mesh(new T.RingGeometry(1.1,1.25,24,1,-tuning.attack.halfAngle,tuning.attack.halfAngle*2),new T.MeshBasicMaterial({color:0xfbe5b8,transparent:true,opacity:.7,depthTest:true,depthWrite:false,side:T.DoubleSide}));this.slash.rotation.x=-Math.PI/2;this.scene.add(this.flare,this.slash);
    const aimGeo=new T.RingGeometry(.16,.19,32),aimMat=new T.MeshBasicMaterial({color:0xe5bd77,transparent:true,opacity:.9,depthWrite:false});this.aim=new T.Mesh(aimGeo,aimMat);this.aim.rotation.x=-Math.PI/2;this.scene.add(this.aim);
    this.buildRoom();this.resize();this.lookRenderer=new LightingLab(this);this.sceneEffects=new SceneVisualEffects(this.packs,this.camera);this.scene.add(this.sceneEffects.group);
  }
  ownedMesh(geometry:T.BufferGeometry,material:T.Material){this.roomOwned.push(geometry,material);return new T.Mesh(geometry,material);}
  buildRoom(){
    if(worldVisuals[this.area.id])this.inkRoom=new InkRoom(this.area,this.packs,this.room,this.camera,this.shadowTexture,this.registration);
    const bounds=this.area.bounds,surface=this.area.surface,axis=(min:number,max:number,name:'x'|'z')=>{const values=[min,max];for(let n=min+2;n<max;n+=2)values.push(n);if(surface.kind!=='flat'&&surface.axis===name){values.push(surface.start,surface.end);if(surface.kind==='stairs')for(let i=1;i<surface.steps!;i++)values.push(surface.start+(surface.end-surface.start)*i/surface.steps!);}if(surface.kind==='stairs'&&surface.terraceBounds){values.push(...(name==='x'?[surface.terraceBounds.minX,surface.terraceBounds.maxX,-surface.stairWidth!/2,surface.stairWidth!/2]:[surface.terraceBounds.minZ,surface.terraceBounds.maxZ]));}return [...new Set(values)].sort((a,b)=>a-b);};
    const xs=axis(bounds.minX-72,bounds.maxX+72,'x'),zs=axis(bounds.minZ-72,bounds.maxZ+72,'z'),vertices:number[]=[],indices:number[]=[];
    const quad=(a:number[],b:number[],c:number[],d:number[])=>{const first=vertices.length/3;vertices.push(...a,...b,...c,...d);indices.push(first,first+2,first+1,first+1,first+2,first+3);};
    for(let zi=0;zi<zs.length-1;zi++)for(let xi=0;xi<xs.length-1;xi++){
      const x=xs[xi]!,nx=xs[xi+1]!,z=zs[zi]!,nz=zs[zi+1]!,stepped=surface.kind==='stairs',middle=heightAt(this.area,(x+nx)/2,(z+nz)/2)-.01;
      const y=(px:number,pz:number)=>this.inkRoom&&stepped?surface.startHeight-.01:stepped?middle:heightAt(this.area,px,pz)-.01;
      quad([x,y(x,z),z],[nx,y(nx,z),z],[x,y(x,nz),nz],[nx,y(nx,nz),nz]);
      if(!this.inkRoom&&stepped&&xi>0){const before=heightAt(this.area,(xs[xi-1]!+x)/2,(z+nz)/2)-.01;if(Math.abs(before-middle)>1e-6)quad([x,before,nz],[x,before,z],[x,middle,nz],[x,middle,z]);}
      if(!this.inkRoom&&stepped&&zi>0){const before=heightAt(this.area,(x+nx)/2,(zs[zi-1]!+z)/2)-.01;if(Math.abs(before-middle)>1e-6)quad([x,before,z],[nx,before,z],[x,middle,z],[nx,middle,z]);}
    }
    const floorGeometry=new T.BufferGeometry();floorGeometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));floorGeometry.setIndex(indices);floorGeometry.computeVertexNormals();floorGeometry.setAttribute('uv',new T.Float32BufferAttribute(vertices.flatMap((_,i)=>i%3===0?[...floorUV(vertices[i]!,vertices[i+2]!)]:[]),2));
    const floor=this.ownedMesh(floorGeometry,this.inkRoom?this.inkRoom.floorMaterial():new T.MeshStandardMaterial({color:this.area.floorColor,roughness:1,depthTest:true,depthWrite:false}));floor.renderOrder=DEPTH_STAGE.ground;this.room.add(floor);
    if(this.inkRoom){this.inkRoom.build();return;}
    for(const p of this.area.props){
      const ground=heightAt(this.area,p.x,p.z);
      const material=new T.MeshStandardMaterial({color:p.kind==='border'?0x4d5260:p.kind==='tree'?0x495452:0x6b6770,roughness:1});
      const geometry=p.kind==='border'?new T.BoxGeometry(p.size![0],p.height,p.size![1]):p.kind==='wall'?new T.BoxGeometry(1.4,p.height,.6):new T.CylinderGeometry(p.radius*.85,p.radius,p.height,6);
      const base=this.ownedMesh(geometry,material) as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;base.position.set(p.x,ground+p.height/2,p.z);base.userData.foot={x:p.x,y:ground,z:p.z};base.userData.id=p.id;if(p.kind!=='border')this.fadeMeshes.push(base);this.room.add(base);
      if(p.kind==='tree'||p.kind==='foreground'){
        const crown=this.ownedMesh(new T.IcosahedronGeometry(1.1,0),new T.MeshStandardMaterial({color:p.kind==='tree'?0x43524c:0x55414c,roughness:1})) as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
        crown.position.set(p.x,ground+p.height,p.z);crown.scale.set(1.35,.48,1.1);crown.userData.foot={x:p.x,y:ground,z:p.z};this.fadeMeshes.push(crown);this.room.add(crown);
      }else if(p.kind==='pillar'){
        const cap=this.ownedMesh(new T.CylinderGeometry(.65,.65,.18,6),new T.MeshStandardMaterial({color:0x97908c,roughness:1})) as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;cap.position.set(p.x,ground+p.height,p.z);cap.userData.foot={x:p.x,y:ground,z:p.z};this.fadeMeshes.push(cap);this.room.add(cap);
      }
    }
    for(const exit of this.area.exits){const shrine=this.ownedMesh(new T.TorusGeometry(.6,.08,6,24),new T.MeshStandardMaterial({color:0xd2ac63,emissive:0x7b461f,emissiveIntensity:.4}));shrine.position.set(exit.marker.x,heightAt(this.area,exit.marker.x,exit.marker.z)+1,exit.marker.z);this.room.add(shrine);}

    const gridPoints:T.Vector3[]=[],gx=axis(bounds.minX,bounds.maxX,'x'),gz=axis(bounds.minZ,bounds.maxZ,'z');
    for(const x of gx)for(let i=1;i<gz.length;i++)gridPoints.push(new T.Vector3(x,heightAt(this.area,x,gz[i-1]!)+.012,gz[i-1]),new T.Vector3(x,heightAt(this.area,x,gz[i]!)+.012,gz[i]));
    for(const z of gz)for(let i=1;i<gx.length;i++)gridPoints.push(new T.Vector3(gx[i-1],heightAt(this.area,gx[i-1]!,z)+.012,z),new T.Vector3(gx[i],heightAt(this.area,gx[i]!,z)+.012,z));
    const gridGeometry=new T.BufferGeometry().setFromPoints(gridPoints),gridMaterial=new T.LineBasicMaterial({color:0x4c6169,depthWrite:false}),grid=new T.LineSegments(gridGeometry,gridMaterial);grid.renderOrder=DEPTH_STAGE.groundGrid;this.room.add(grid);this.roomOwned.push(gridGeometry,gridMaterial);
  }
  disposeRoom(){this.inkRoom?.dispose();this.inkRoom=undefined;for(const v of this.actors.values()){v.sprite.dispose();v.shadow.geometry.dispose();v.shadow.material.dispose();v.ring.geometry.dispose();(v.ring.material as T.Material).dispose();}this.actors.clear();for(const r of this.roomOwned)r.dispose();this.roomOwned=[];this.room.clear();this.fadeMeshes=[];}
  resetRoom(area:AreaDefinition=this.area){this.sceneEffects.reset();this.lookRenderer.resetRoom();this.disposeRoom();this.area=area;this.buildRoom();this.effectTag='';}
  createVisual(a:Actor,generation:number){
    const binding=actorVisuals[a.definition.visual];if(!binding)throw new Error(`unknown visual ${a.definition.visual}`);const pack=this.packs.get(binding.asset);if(!pack)throw new Error(`asset not acquired ${binding.asset}`);const sprite=new ActorSprite(`${generation}:${a.id}`,pack.manifest,pack.textures,this.getClip(binding.clips.idle,'d45',pack.manifest));sprite.material.color.set(binding.tint);
    const shadow=new T.Mesh(new T.CircleGeometry(sprite.manifest.asset.shadow.radius,32),new T.MeshBasicMaterial({map:this.shadowTexture,color:0xffffff,transparent:true,opacity:sprite.manifest.asset.shadow.opacity,depthTest:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;
    const ring=new T.Mesh(new T.RingGeometry(a.definition.radius,a.definition.radius+.025,24),new T.MeshBasicMaterial({color:a.kind==='hero'?0xd1ba7c:0xc1645f,transparent:true,opacity:.5,depthWrite:false}));ring.rotation.x=-Math.PI/2;
    this.room.add(sprite.mesh,shadow,ring);const v={sprite,shadow,ring,tag:'',heading:'d45' as const};this.actors.set(a.id,v);return v;
  }
  getClip(id:string,dir:typeof HEADINGS[number],manifest=this.manifest):Clip {const clip=resolveClip(manifest,id,dir);return id==='walk'&&manifest.asset.id==='ink-hero'?timedWalk(clip,this.walkTiming):clip;}
  get viewSpan(){return this.verticalSpan;}
  update(sim:Simulation,alpha:number,ms:number,aim:{x:number;z:number}){
    if(this.generation!==sim.generation){this.resetRoom(sim.areaDefinition);this.generation=sim.generation;}
    const lab=false;this.room.visible=true;
    if(!lab&&tuning.cameraFollow){const hero=sim.hero,x=hero.px+(hero.x-hero.px)*alpha,z=hero.pz+(hero.z-hero.pz)*alpha;this.cameraTarget.set(x,heightAt(sim.areaDefinition,x,z),z);const framed=compositionPoint(sim.area,{x,z});this.viewTarget.set(framed.x,heightAt(sim.areaDefinition,framed.x,framed.z),framed.z);this.camera.position.copy(this.viewTarget).addScaledVector(outward,30);this.camera.lookAt(this.viewTarget);this.camera.updateMatrixWorld();}
    const swing=swordCombo[sim.hero.swingStage]!;
    this.flare.visible=(!this.inkRoom||this.debug)&&!lab&&((sim.hero.state==='ability'&&sim.hero.age>=tuning.ability.windup)||this.debug);this.slash.visible=!this.inkRoom&&!lab&&sim.hero.state==='attack'&&sim.hero.age>=swing.windup&&sim.hero.age<swing.activeEnd;
    this.flare.position.set(sim.hero.x,sim.hero.y+.06,sim.hero.z);this.flare.rotation.z=(sim.hero.state==='ability'?sim.hero.yaw:sim.hero.aim)-Math.PI/2;this.flare.scale.setScalar(1);(this.flare.material as T.MeshBasicMaterial).opacity=sim.hero.state==='ability'?Math.max(0,1-sim.hero.age/tuning.ability.total)*.6:.12;
    if(this.flare.visible){const points=this.flare.geometry.getAttribute('position'),a=this.flare.rotation.z,c=Math.cos(a),s=Math.sin(a);for(let i=0;i<points.count;i++){const x=points.getX(i),y=points.getY(i),wx=sim.hero.x+x*c-y*s,wz=sim.hero.z-x*s-y*c;points.setZ(i,heightAt(sim.areaDefinition,wx,wz)-sim.hero.y);}points.needsUpdate=true;}
    const effectTag=`${sim.hero.swingStage}`;if(effectTag!==this.effectTag){this.slash.geometry.dispose();this.slash.geometry=new T.RingGeometry(swing.range-.16,swing.range,24,1,-swing.halfAngle,swing.halfAngle*2);this.effectTag=effectTag;}
    this.slash.position.set(sim.hero.x,sim.hero.y+.25,sim.hero.z);this.slash.rotation.z=sim.hero.yaw-Math.PI/2;
    this.renderer.setClearColor(this.background==='light'?0xd1c9b4:0x151923);this.aim.visible=!lab;this.aim.position.set(aim.x,heightAt(sim.areaDefinition,aim.x,aim.z)+.035,aim.z);
      for(const a of sim.actors){const v=this.actors.get(a.id)??this.createVisual(a,sim.generation),heading=v.sprite.manifest.asset.viewMode==='fixed-authored'?'d45' as const:selectDirection(a.yaw,v.heading),binding=actorVisuals[a.definition.visual]!,id=a.state==='attack'?binding.attacks[a.kind==='hero'?a.swingStage:0]!:binding.clips[a.state],tag=`${sim.generation}:${id}:${heading}:${a.action}`;
        const selectedClip=this.getClip(id,heading,v.sprite.manifest);
        if(tag!==v.tag||v.sprite.animator.clip!==selectedClip){const old=v.sprite.animator.time,previous=v.sprite.animator.clip,keepPhase=(a.state==='walk'||a.state==='idle')&&v.tag.split(':')[1]===id;v.sprite.animator.start(selectedClip);if(keepPhase)v.sprite.animator.seek(previous===selectedClip?old:remapWalkTime(previous,selectedClip,old));v.tag=tag;v.heading=v.sprite.manifest.asset.viewMode==='fixed-authored'?'d45':heading;}
        const clip=v.sprite.animator.clip;
        if(a.health<=0&&a.age>=tuning.deathHoldTicks&&v.sprite.animator.time===0)v.sprite.animator.seek(clipDuration(clip));
        let notifies:ReturnType<Animator['advance']>=[];
        if(a.state==='attack'){
          const t=attackDefinition(a),duration=clipDuration(clip),strike=clip.notifies.find(n=>n.kind==='whoosh')?.atMs??duration*t.windup/t.total,end=strike+duration*(t.activeEnd-t.windup)/t.total;
          const visual=a.age<=t.windup?a.age/t.windup*strike:a.age<t.activeEnd?strike+(a.age-t.windup)/(t.activeEnd-t.windup)*(end-strike):end+(a.age-t.activeEnd)/(t.total-t.activeEnd)*(duration-end);
          notifies=v.sprite.animator.advance(Math.max(0,visual-v.sprite.animator.time));
        }else if(a.state==='death')notifies=v.sprite.animator.advance(Math.max(0,Math.min(1,a.age/(tuning.deathHoldTicks-9))*clipDuration(clip)-v.sprite.animator.time));
        else if(a.state==='ability'){const duration=clipDuration(clip),flash=clip.notifies.find(n=>n.kind==='flash')?.atMs??duration*tuning.ability.windup/tuning.ability.total,visual=a.age<=tuning.ability.windup?a.age/tuning.ability.windup*flash:flash+(a.age-tuning.ability.windup)/(tuning.ability.total-tuning.ability.windup)*(duration-flash);notifies=v.sprite.animator.advance(Math.max(0,visual-v.sprite.animator.time));}
        else if(a.state==='dodge'||a.state==='hurt'){const total=a.state==='dodge'?tuning.dodge.total:tuning.hurt.total;notifies=v.sprite.animator.advance(Math.max(0,a.age/total*clipDuration(clip)-v.sprite.animator.time));}
        else notifies=v.sprite.animator.advance(ms);
        this.events.publish(notifies.map(n=>({key:`visual:${n.key}`,kind:'animation-notify',notify:n.kind,clip:id,instance:n.instance,timeMs:n.timeMs,tick:sim.tick,generation:sim.generation,actor:a.id,action:a.action,area:sim.area,position:Object.freeze([a.x,a.y,a.z]),direction:a.yaw}) as AnimationEvent));
        const x=a.px+(a.x-a.px)*alpha,z=a.pz+(a.z-a.pz)*alpha,foot=new T.Vector3(x,heightAt(sim.areaDefinition,x,z),z);v.sprite.stabilized=a.kind==='hero'?this.walkStabilized:true;v.sprite.rigidSword=this.walkRigidSword;v.sprite.showAnimation(foot,this.camera,a.kind==='hero'&&a.state==='walk'?this.walkBlend:'original',this.walkFlow);v.sprite.mesh.visible=a.health>0||a.kind==='hero'||a.age<tuning.deathHoldTicks;
        const gradient=surfaceGradient(sim.areaDefinition,x,z);this.groundNormal.set(-gradient.x,1,-gradient.z).normalize();v.shadow.quaternion.setFromUnitVectors(this.planeNormal,this.groundNormal);v.ring.quaternion.copy(v.shadow.quaternion);
        v.shadow.position.set(foot.x,foot.y+.03,foot.z);v.shadow.visible=a.health>0;v.ring.position.set(foot.x,foot.y+.035,foot.z);v.ring.visible=this.debug||(!this.inkRoom&&a.kind==='enemy'&&(a.state==='attack'||a.stun>0));
        if(a.kind==='enemy'&&a.state==='attack'){v.ring.scale.setScalar(1+a.age/Math.max(1,a.definition.melee.windup)*2);(v.ring.material as T.MeshBasicMaterial).color.set(a.age<a.definition.melee.windup?0xc66e55:0xe5c37d);}else v.ring.scale.setScalar(1);
      }
      this.light.position.set(sim.hero.x-.25,sim.hero.y+.85,sim.hero.z);this.light.intensity=sim.hero.state==='ability'?14:5;
      for(const m of this.fadeMeshes){const p=m.userData.foot as{x:number;y:number;z:number},delta=new T.Vector3(sim.hero.x-p.x,sim.hero.y-p.y,sim.hero.z-p.z);const fade=delta.length()<1.65&&delta.dot(outward)<0;
        setCutoutOpacity(m.material,fade?.38:1);}
    this.inkRoom?.update(sim,alpha,!lab,ms);
    this.sceneEffects.update(sim.areaDefinition,sim.generation,this.inkRoom?.sprites??[],ms,this.visualEffects);
    this.renderFrame(sim,ms);
  }
  setVisualEffects(options:Partial<VisualEffects>){this.visualEffects={...this.visualEffects,...options};}
  setWeather(state:WeatherState|null){this.sceneEffects.setWeather(state);}
  setDepthOfField(value:number){if(!Number.isFinite(value))return;this.depthOfField=Math.max(0,Math.min(1,value));this.lookRenderer.setSettings({depthOfField:this.depthOfField});}
  protected renderFrame(sim:Simulation,ms:number){if(worldVisuals[sim.area]&&this.mode!=='lighting')this.lookRenderer.setSettings({rig:'silver',look:'ink',strength:.85,depthOfField:this.depthOfField});this.lookRenderer.render(sim,ms);}
  resize(scale=contract.renderScale){const width=this.canvas.clientWidth,height=this.canvas.clientHeight;if(width<=0||height<=0)return;const buffer=drawingBufferSize(width,height,devicePixelRatio,scale);this.requestedRenderScale=scale;this.effectivePixelRatio=buffer.pixelRatio;this.renderer.setPixelRatio(buffer.pixelRatio);this.renderer.setSize(width*scale,height*scale,false);resizeCamera(this.camera,width,height,this.viewSpan);}
  warmPack(pack:PackLease){if(this.renderer.capabilities.maxTextureSize<Math.max(...pack.manifest.pages.map(p=>Math.max(p.width,p.height))))throw new Error('GPU maximum texture size below atlas dimensions');for(const texture of pack.textures.values()){if(texture.generateMipmaps)texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.renderer.initTexture(texture);}}
  async loadWalkFlow(){
    const walkFlowData=this.registration.walk;const response=await fetch('/walk/flow.png');if(!response.ok)throw new Error('walk motion fields unavailable');
    const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==walkFlowData.sha256)throw new Error('walk motion field hash differs');
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
    if(bitmap.width!==walkFlowData.width||bitmap.height!==walkFlowData.height){bitmap.close();throw new Error('walk motion field dimensions differ');}
    if(this.disposed){bitmap.close();throw new Error('presentation disposed');}
    const texture=new T.Texture(bitmap);texture.flipY=false;texture.generateMipmaps=false;texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
    this.flowBitmap=bitmap;this.walkFlow={texture,...walkFlowData};this.renderer.initTexture(texture);
  }
  async warm(){await this.lookRenderer.prepare();if(this.disposed)throw new Error('presentation disposed');for(const pack of this.packs.values())this.warmPack(pack);await this.renderer.compileAsync(this.scene,this.camera);if(this.disposed)throw new Error('presentation disposed');this.renderer.render(this.scene,this.camera);}
  stats(){const pages=new Map([...this.packs.values()].flatMap(pack=>pack.manifest.pages.map(page=>[pageIdentity(page),page] as const)));const size=this.renderer.getDrawingBufferSize(new T.Vector2());return{buffer:size.toArray(),logical:[this.canvas.clientWidth,this.canvas.clientHeight],devicePixelRatio,effectivePixelRatio:this.effectivePixelRatio,nativeDisplayPixels:[Math.round(this.canvas.clientWidth*devicePixelRatio),Math.round(this.canvas.clientHeight*devicePixelRatio)],verticalSpan:this.verticalSpan,viewSpan:this.viewSpan,area:this.area.id,generation:this.generation,renderScale:this.requestedRenderScale,walkBlend:this.walkBlend,walkStabilized:this.walkStabilized,walkTiming:this.walkTiming,walkRigidSword:this.walkRigidSword,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,objects:{...this.renderer.info.memory},surfaceTextureBytes:this.inkRoom?.architecture?.textureBytes??0,atlasBytes:(this.inkRoom?.architecture?.textureBytes??0)+[...pages.values()].reduce((s,p)=>s+Math.ceil(p.rgbaBytes*(p.mipmaps?4/3:1)),0)+(this.walkFlow?this.registration.walk.width*this.registration.walk.height*4:0),fileBytes:[...pages.values()].reduce((s,p)=>s+p.bytes,0)+(this.walkFlow?this.registration.walk.bytes:0),actors:this.actors.size,webgl:this.renderer.getContext().getParameter(this.renderer.getContext().VERSION),gpu:this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')?this.renderer.getContext().getParameter(this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL):'unavailable'};}
  dispose(){if(this.disposed)return;this.disposed=true;this.sceneEffects?.dispose();this.lookRenderer?.dispose();this.disposeRoom();for(const m of [this.aim,this.flare,this.slash]){m.geometry.dispose();(m.material as T.Material).dispose();}this.walkFlow?.texture.dispose();this.flowBitmap?.close();this.shadowTexture.dispose();this.renderer.dispose();}
}
