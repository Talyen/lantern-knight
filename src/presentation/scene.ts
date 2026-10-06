import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {contract,makeCamera,resizeCamera,selectDirection,HEADINGS,right,up,outward} from '../core/camera';
import {ActorSprite} from './sprite';
import {Animator,clipDuration} from '../core/animation';
import type {Manifest,Clip,Frame} from '../assets/schema';
import {attackDefinition,swordCombo,tuning} from '../content/gameplay';
import {content,heightAt,surfaceGradient,type AreaDefinition,type ActorId,PLAYER_ID} from '../content/world';
import {actorVisuals} from '../content/visuals';
import {pageIdentity,type PackLease} from '../assets/loader';
import {EventHub,type AnimationEvent} from '../core/events';
import type {Actor,Simulation} from '../core/simulation';
export type Mode='encounter'|'calibration'|'animation'|'occlusion';
type Visual={sprite:ActorSprite;shadow:T.Mesh<T.CircleGeometry,T.MeshBasicMaterial>;ring:T.Mesh;tag:string;heading:typeof HEADINGS[number]};
// Flat ground is an opaque background pass: a camera-facing baked foot may project
// below its root and must not be cut by the ground's world-space depth surface.
const DEPTH_STAGE={ground:-2,groundGrid:-1,world:0} as const;
export class Presentation {
  renderer:T.WebGLRenderer;camera=makeCamera(16/9);scene=new T.Scene();room=new T.Group();calibration=new T.Group();actors=new Map<ActorId,Visual>();mode:Mode='encounter';
  aim:T.Mesh;light=new T.PointLight(0xf7b862,5,5,2);fadeMeshes:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>[]=[];
  roomOwned:{dispose:()=>void}[]=[];debug=false;labTime=0;labClip=actorVisuals[content.actor(content.definitions.player).visual]!.clips.walk;labHeading:typeof HEADINGS[number]='d45';labPaused=false;labSpeed=1;notifyLog:string[]=[];
  labSprite:ActorSprite;secondSprite:ActorSprite;labAnimator:Animator;overlay=new T.Group();overlayOwned:{dispose:()=>void}[]=[];frameMap=new Map<string,Frame>();
  lastLabOverlay='';background='dark';
  proxy:T.Group|undefined;comparisonElevation=contract.elevationDeg;shadowTexture:T.CanvasTexture;
  cameraTarget=new T.Vector3();
  verticalSpan=contract.verticalSpan;area:AreaDefinition=content.area('court');generation=-1;
  groundNormal=new T.Vector3(0,1,0);planeNormal=new T.Vector3(0,0,1);effectTag='';
  flare:T.Mesh;slash:T.Mesh;
  get manifest(){return this.packs.get(this.labAsset)!.manifest;}
  get textures(){return this.packs.get(this.labAsset)!.textures;}
  labAsset=actorVisuals[content.actor(content.definitions.player).visual]!.asset;
  constructor(public canvas:HTMLCanvasElement,public packs:Map<string,PackLease>,public events:EventHub){
    const manifest=this.manifest,textures=this.textures;
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.setPixelRatio(contract.pixelRatioCap);this.renderer.setClearColor(0x151923);
    if(this.renderer.capabilities.maxTextureSize<Math.max(...manifest.pages.map(p=>Math.max(p.width,p.height))))throw new Error('GPU maximum texture size below compiled atlas dimensions');
    this.scene.add(new T.HemisphereLight(0xc5d4e1,0x392b30,2));const sun=new T.DirectionalLight(0xe9d2ac,2);sun.position.set(-4,8,3);this.scene.add(sun,this.light,this.room,this.calibration,this.overlay);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=64;shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d')!,gradient=ctx.createRadialGradient(32,32,2,32,32,32);gradient.addColorStop(0,'rgba(0,0,0,0.5)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);this.shadowTexture=new T.CanvasTexture(shadowCanvas);this.shadowTexture.generateMipmaps=false;
    this.flare=new T.Mesh(new T.RingGeometry(.02,tuning.ability.range,48,6,-tuning.ability.halfAngle,tuning.ability.halfAngle*2),new T.MeshBasicMaterial({color:0xf4c575,transparent:true,opacity:.35,depthTest:true,depthWrite:false,side:T.DoubleSide}));this.flare.rotation.x=-Math.PI/2;this.flare.frustumCulled=false;
    this.slash=new T.Mesh(new T.RingGeometry(1.1,1.25,24,1,-tuning.attack.halfAngle,tuning.attack.halfAngle*2),new T.MeshBasicMaterial({color:0xfbe5b8,transparent:true,opacity:.7,depthTest:true,depthWrite:false,side:T.DoubleSide}));this.slash.rotation.x=-Math.PI/2;this.scene.add(this.flare,this.slash);
    const aimGeo=new T.RingGeometry(.16,.19,32),aimMat=new T.MeshBasicMaterial({color:0xe5bd77,transparent:true,opacity:.9,depthWrite:false});this.aim=new T.Mesh(aimGeo,aimMat);this.aim.rotation.x=-Math.PI/2;this.scene.add(this.aim);
    const c=manifest.asset.clips[this.labClip]!.d45!;
    this.labSprite=new ActorSprite('lab-a',manifest,textures,c);this.secondSprite=new ActorSprite('lab-b',manifest,textures,manifest.asset.clips[actorVisuals[content.actor(content.definitions.player).visual]!.attacks[0]!]!.d45!);this.labAnimator=this.labSprite.animator;
    this.scene.add(this.labSprite.mesh,this.secondSprite.mesh);this.frameMap=new Map(manifest.frames.map(f=>[f.id,f]));this.buildRoom();this.buildCalibration();this.resize();
  }
  ownedMesh(geometry:T.BufferGeometry,material:T.Material){this.roomOwned.push(geometry,material);return new T.Mesh(geometry,material);}
  buildRoom(){
    const bounds=this.area.bounds,surface=this.area.surface,axis=(min:number,max:number,name:'x'|'z')=>{const values=[min,max];for(let n=min+1;n<max;n++)values.push(n);if(surface.kind==='ramp'&&surface.axis===name)values.push(...[surface.start,surface.end].filter(v=>v>min&&v<max));return [...new Set(values)].sort((a,b)=>a-b);};
    const xs=axis(bounds.minX-.5,bounds.maxX+.5,'x'),zs=axis(bounds.minZ-.5,bounds.maxZ+.5,'z'),vertices:number[]=[],indices:number[]=[];
    for(const z of zs)for(const x of xs)vertices.push(x,heightAt(this.area,x,z)-.01,z);
    for(let z=0;z<zs.length-1;z++)for(let x=0;x<xs.length-1;x++){const a=z*xs.length+x,b=a+1,c=a+xs.length,d=c+1;indices.push(a,c,b,b,c,d);}
    const floorGeometry=new T.BufferGeometry();floorGeometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));floorGeometry.setIndex(indices);floorGeometry.computeVertexNormals();
    const floor=this.ownedMesh(floorGeometry,new T.MeshStandardMaterial({color:this.area.floorColor,roughness:1,depthTest:true,depthWrite:false}));floor.renderOrder=DEPTH_STAGE.ground;this.room.add(floor);
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
  disposeRoom(){for(const v of this.actors.values()){v.sprite.dispose();v.shadow.geometry.dispose();v.shadow.material.dispose();v.ring.geometry.dispose();(v.ring.material as T.Material).dispose();}this.actors.clear();for(const r of this.roomOwned)r.dispose();this.roomOwned=[];this.room.clear();this.fadeMeshes=[];}
  resetRoom(area:AreaDefinition=this.area){this.disposeRoom();this.area=area;this.buildRoom();this.effectTag='';}
  buildCalibration(){
    this.calibration.add(new T.GridHelper(14,14,0xbfae82,0x58626b));const cube=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0xc8bca4}));cube.position.set(-2,.5,-2);this.calibration.add(cube);
    const footprint=new T.Mesh(new T.RingGeometry(tuning.heroRadius,tuning.heroRadius+.035,32),new T.MeshBasicMaterial({color:0x77e4b3,depthTest:true}));footprint.rotation.x=-Math.PI/2;footprint.position.y=.025;this.calibration.add(footprint);
    for(const [dir,color] of [[new T.Vector3(1,0,0),0xe28176],[new T.Vector3(0,1,0),0xa4c47b],[new T.Vector3(0,0,1),0x81b1dd]] as const)this.calibration.add(new T.ArrowHelper(dir,new T.Vector3(-4,0,0),2,color));
    for(let i=0;i<8;i++){const yaw=i*Math.PI/4,dir=new T.Vector3(Math.sin(yaw),0,Math.cos(yaw));this.calibration.add(new T.ArrowHelper(dir,new T.Vector3(0,.03,0),2.5,0xe4be76));}
    for(const [color,x] of [[0x808080,-4],[0xe9bc67,-3],[0x263b4a,-2]] as const){const m=new T.Mesh(new T.PlaneGeometry(.65,.65),new T.MeshBasicMaterial({color,toneMapped:false}));m.quaternion.copy(this.camera.quaternion);m.position.set(x,2,1);this.calibration.add(m);}
  }
  getClip(id:string,dir:typeof HEADINGS[number],manifest=this.manifest):Clip {const exact=manifest.asset.clips[id]?.[dir];if(exact)return exact;const fallback=manifest.asset.fallbacks[id];if(fallback){console.warn(`Explicit development fallback ${id} -> ${fallback}`);return manifest.asset.clips[fallback]![dir]!;}throw new Error(`required clip unavailable: ${id}/${dir}`);}
  selectLabAsset(id:string){if(id===this.labAsset)return;const pack=this.packs.get(id);if(!pack)throw new Error('lab asset not loaded');this.labAsset=id;this.labSprite.dispose();this.labClip=Object.keys(pack.manifest.asset.clips)[0]!;this.labSprite=new ActorSprite('lab-a',pack.manifest,pack.textures,this.getClip(this.labClip,this.labHeading));this.labAnimator=this.labSprite.animator;this.scene.add(this.labSprite.mesh);this.frameMap=new Map(pack.manifest.frames.map(f=>[f.id,f]));this.lastLabOverlay='';this.notifyLog=[];}
  createVisual(a:Actor,generation:number){
    const binding=actorVisuals[a.definition.visual];if(!binding)throw new Error(`unknown visual ${a.definition.visual}`);const pack=this.packs.get(binding.asset);if(!pack)throw new Error(`asset not acquired ${binding.asset}`);const sprite=new ActorSprite(`${generation}:${a.id}`,pack.manifest,pack.textures,this.getClip(binding.clips.idle,'d45',pack.manifest));sprite.material.color.set(binding.tint);
    const shadow=new T.Mesh(new T.CircleGeometry(sprite.manifest.asset.shadow.radius,32),new T.MeshBasicMaterial({map:this.shadowTexture,color:0xffffff,transparent:true,opacity:sprite.manifest.asset.shadow.opacity,depthTest:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;
    const ring=new T.Mesh(new T.RingGeometry(a.definition.radius,a.definition.radius+.025,24),new T.MeshBasicMaterial({color:a.kind==='hero'?0xd1ba7c:0xc1645f,transparent:true,opacity:.5,depthWrite:false}));ring.rotation.x=-Math.PI/2;
    this.room.add(sprite.mesh,shadow,ring);const v={sprite,shadow,ring,tag:'',heading:'d45' as const};this.actors.set(a.id,v);return v;
  }
  setMode(mode:Mode){this.mode=mode;this.lastLabOverlay='';this.compareCamera(contract.elevationDeg);}
  compareCamera(elevation:number){this.comparisonElevation=elevation;const a=contract.azimuthDeg*Math.PI/180,e=elevation*Math.PI/180;this.camera.position.set(Math.sin(a)*Math.cos(e)*30,Math.sin(e)*30,Math.cos(a)*Math.cos(e)*30);this.camera.lookAt(0,0,0);this.camera.updateMatrixWorld();}
  async loadProxy(){const gltf=await new GLTFLoader().loadAsync('/calibration-proxy.glb');this.proxy=gltf.scene;this.proxy.traverse(o=>{if(o instanceof T.Camera||o instanceof T.Light)o.visible=false;});this.calibration.add(this.proxy);}
  update(sim:Simulation,alpha:number,ms:number,aim:{x:number;z:number}){
    if(this.generation!==sim.generation){this.resetRoom(sim.areaDefinition);this.generation=sim.generation;}
    const lab=this.mode==='animation'||this.mode==='calibration';this.room.visible=!lab;this.calibration.visible=lab;this.labSprite.mesh.visible=this.mode==='animation';this.secondSprite.mesh.visible=this.mode==='animation';this.overlay.visible=this.mode==='animation'&&this.debug;if(this.proxy)this.proxy.visible=this.mode==='calibration';
    if(!lab&&tuning.cameraFollow){const hero=sim.hero,x=hero.px+(hero.x-hero.px)*alpha,z=hero.pz+(hero.z-hero.pz)*alpha;this.cameraTarget.set(x,heightAt(sim.areaDefinition,x,z),z);this.camera.position.copy(this.cameraTarget).addScaledVector(outward,30);this.camera.lookAt(this.cameraTarget);this.camera.updateMatrixWorld();}
    const swing=swordCombo[sim.hero.swingStage]!;
    this.flare.visible=!lab&&((sim.hero.state==='ability'&&sim.hero.age>=tuning.ability.windup)||this.debug);this.slash.visible=!lab&&sim.hero.state==='attack'&&sim.hero.age>=swing.windup&&sim.hero.age<swing.activeEnd;
    this.flare.position.set(sim.hero.x,sim.hero.y+.06,sim.hero.z);this.flare.rotation.z=(sim.hero.state==='ability'?sim.hero.yaw:sim.hero.aim)-Math.PI/2;this.flare.scale.setScalar(1);(this.flare.material as T.MeshBasicMaterial).opacity=sim.hero.state==='ability'?Math.max(0,1-sim.hero.age/tuning.ability.total)*.6:.12;
    if(this.flare.visible){const points=this.flare.geometry.getAttribute('position'),a=this.flare.rotation.z,c=Math.cos(a),s=Math.sin(a);for(let i=0;i<points.count;i++){const x=points.getX(i),y=points.getY(i),wx=sim.hero.x+x*c-y*s,wz=sim.hero.z-x*s-y*c;points.setZ(i,heightAt(sim.areaDefinition,wx,wz)-sim.hero.y);}points.needsUpdate=true;}
    const effectTag=`${sim.hero.swingStage}`;if(effectTag!==this.effectTag){this.slash.geometry.dispose();this.slash.geometry=new T.RingGeometry(swing.range-.16,swing.range,24,1,-swing.halfAngle,swing.halfAngle*2);this.effectTag=effectTag;}
    this.slash.position.set(sim.hero.x,sim.hero.y+.25,sim.hero.z);this.slash.rotation.z=sim.hero.yaw-Math.PI/2;
    this.renderer.setClearColor(this.background==='light'?0xd1c9b4:0x151923);this.aim.visible=!lab;this.aim.position.set(aim.x,heightAt(sim.areaDefinition,aim.x,aim.z)+.035,aim.z);
    if(lab){
      const c=this.getClip(this.labClip,this.labHeading);
      if(this.labAnimator.clip!==c){this.labAnimator.start(c);this.labTime=0;}
      if(!this.labPaused){const events=this.labAnimator.advance(ms*this.labSpeed);this.notifyLog.push(...events.map(e=>e.key+' '+e.kind));this.notifyLog=this.notifyLog.slice(-10);this.labTime=this.labAnimator.time;}
      const position=this.mode==='animation'?new T.Vector3(-1.2,0,0):new T.Vector3(0,0,0);
      const f=this.labSprite.show(this.labAnimator.frame,position,this.camera);
      this.secondSprite.animator.advance(ms*.7);this.secondSprite.show(this.secondSprite.animator.frame,new T.Vector3(1.2,0,0),this.camera);
      this.secondSprite.material.color.set(0x98a8c3);
      if(this.debug&&this.lastLabOverlay!==f.id){this.drawOverlay(f,position);this.lastLabOverlay=f.id;}
    }else{
      for(const a of sim.actors){const v=this.actors.get(a.id)??this.createVisual(a,sim.generation),heading=selectDirection(a.yaw,v.heading),binding=actorVisuals[a.definition.visual]!,id=a.state==='attack'?binding.attacks[a.kind==='hero'?a.swingStage:0]!:binding.clips[a.state],tag=`${sim.generation}:${id}:${heading}:${a.action}`;
        if(tag!==v.tag){const old=v.sprite.animator.time,keepPhase=(a.state==='walk'||a.state==='idle')&&v.tag.split(':')[1]===id;v.sprite.animator.start(this.getClip(id,heading,v.sprite.manifest));if(keepPhase)v.sprite.animator.seek(old);v.tag=tag;v.heading=heading;}
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
        const x=a.px+(a.x-a.px)*alpha,z=a.pz+(a.z-a.pz)*alpha,foot=new T.Vector3(x,heightAt(sim.areaDefinition,x,z),z);v.sprite.show(v.sprite.animator.frame,foot,this.camera);
        const gradient=surfaceGradient(sim.areaDefinition,x,z);this.groundNormal.set(-gradient.x,1,-gradient.z).normalize();v.shadow.quaternion.setFromUnitVectors(this.planeNormal,this.groundNormal);v.ring.quaternion.copy(v.shadow.quaternion);
        v.shadow.position.set(foot.x,foot.y+.03,foot.z);v.shadow.visible=a.health>0;v.ring.position.set(foot.x,foot.y+.035,foot.z);v.ring.visible=this.debug||(a.kind==='enemy'&&(a.state==='attack'||a.stun>0));
        if(a.kind==='enemy'&&a.state==='attack'){v.ring.scale.setScalar(1+a.age/Math.max(1,a.definition.melee.windup)*2);(v.ring.material as T.MeshBasicMaterial).color.set(a.age<a.definition.melee.windup?0xc66e55:0xe5c37d);}else v.ring.scale.setScalar(1);
      }
      this.light.position.set(sim.hero.x-.25,sim.hero.y+.85,sim.hero.z);this.light.intensity=sim.hero.state==='ability'?14:5;
      for(const m of this.fadeMeshes){const p=m.userData.foot as{x:number;y:number;z:number},delta=new T.Vector3(sim.hero.x-p.x,sim.hero.y-p.y,sim.hero.z-p.z);const fade=delta.length()<1.65&&delta.dot(outward)<0;
        m.material.transparent=fade;m.material.opacity=fade?.38:1;m.material.depthWrite=!fade;}
    }
    this.renderer.render(this.scene,this.camera);
  }
  drawOverlay(f:Frame,foot:T.Vector3){
    this.overlay.clear();this.overlayOwned.forEach(v=>v.dispose());this.overlayOwned=[];
    const asset=this.manifest.asset,lines=(bounds:number[],color:number)=>{
      const [x,y,w,h]=bounds as[number,number,number,number],ax=asset.anchor[0],ay=asset.anchor[1],d=asset.density;
      const corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
      const pts=corners.map(([px,py])=>foot.clone().addScaledVector(right,(px!-ax)/d).addScaledVector(up,(ay-py!)/d).addScaledVector(outward,.01));
      const geo=new T.BufferGeometry().setFromPoints(pts),mat=new T.LineBasicMaterial({color,depthTest:false});this.overlay.add(new T.Line(geo,mat));this.overlayOwned.push(geo,mat);
    };
    lines([0,0,...asset.canvas],0x78cfe1);lines(f.trim,0xe9bb75);
    for(const [name,p] of Object.entries({foot:asset.anchor,...f.attachments})){
      const pos=foot.clone().addScaledVector(right,(p[0]!-asset.anchor[0])/asset.density).addScaledVector(up,(asset.anchor[1]-p[1]!)/asset.density).addScaledVector(outward,.03);
      const g=new T.CircleGeometry(.035,16),m=new T.MeshBasicMaterial({color:name==='foot'?0x77e4b3:0xffcc51,depthTest:false}),marker=new T.Mesh(g,m);marker.position.copy(pos);marker.quaternion.copy(this.camera.quaternion);this.overlay.add(marker);this.overlayOwned.push(g,m);
    }
  }
  resize(scale=contract.renderScale){const width=this.canvas.clientWidth,height=this.canvas.clientHeight;if(width<=0||height<=0)return;this.renderer.setSize(Math.round(width*scale),Math.round(height*scale),false);resizeCamera(this.camera,width,height,this.verticalSpan);}
  warmPack(pack:PackLease){if(this.renderer.capabilities.maxTextureSize<Math.max(...pack.manifest.pages.map(p=>Math.max(p.width,p.height))))throw new Error('GPU maximum texture size below atlas dimensions');for(const texture of pack.textures.values())this.renderer.initTexture(texture);}
  async warm(){for(const pack of this.packs.values())this.warmPack(pack);this.labSprite.show(this.labSprite.animator.frame,new T.Vector3(),this.camera);this.secondSprite.show(this.secondSprite.animator.frame,new T.Vector3(1.2,0,0),this.camera);await this.loadProxy();await this.renderer.compileAsync(this.scene,this.camera);this.renderer.render(this.scene,this.camera);}
  stats(){const pages=new Map([...this.packs.values()].flatMap(pack=>pack.manifest.pages.map(page=>[pageIdentity(page),page] as const)));const size=this.renderer.getDrawingBufferSize(new T.Vector2());return{buffer:size.toArray(),logical:[this.canvas.clientWidth,this.canvas.clientHeight],devicePixelRatio,verticalSpan:this.verticalSpan,area:this.area.id,generation:this.generation,renderScale:size.y/this.canvas.clientHeight,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,objects:{...this.renderer.info.memory},atlasBytes:[...pages.values()].reduce((s,p)=>s+p.rgbaBytes,0),fileBytes:[...pages.values()].reduce((s,p)=>s+p.bytes,0),actors:this.actors.size,webgl:this.renderer.getContext().getParameter(this.renderer.getContext().VERSION),gpu:this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')?this.renderer.getContext().getParameter(this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL):'unavailable'};}
  dispose(){this.disposeRoom();this.labSprite.dispose();this.secondSprite.dispose();this.overlayOwned.forEach(v=>v.dispose());this.calibration.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments||o instanceof T.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});for(const m of [this.aim,this.flare,this.slash]){m.geometry.dispose();(m.material as T.Material).dispose();}this.shadowTexture.dispose();this.renderer.dispose();}
}
