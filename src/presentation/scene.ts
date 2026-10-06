import * as T from 'three';
import {contract,makeCamera,resizeCamera,selectDirection,HEADINGS,right,up,outward} from '../core/camera';
import {ActorSprite} from './sprite';
import {Animator,clipDuration} from '../core/animation';
import type {Manifest,Clip,Frame} from '../assets/schema';
import {clipForState,props,tuning} from '../content/gameplay';
import type {Actor,Simulation} from '../core/simulation';
export type Mode='encounter'|'calibration'|'animation'|'occlusion';
type Visual={sprite:ActorSprite;shadow:T.Mesh<T.CircleGeometry,T.MeshBasicMaterial>;ring:T.Mesh;tag:string;heading:typeof HEADINGS[number]};
export class Presentation {
  renderer:T.WebGLRenderer;camera=makeCamera(16/9);scene=new T.Scene();room=new T.Group();calibration=new T.Group();actors=new Map<number,Visual>();mode:Mode='encounter';
  aim:T.Mesh;light=new T.PointLight(0xf7b862,5,5,2);fadeMeshes:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>[]=[];
  roomOwned:{dispose:()=>void}[]=[];debug=false;labTime=0;labClip='walk';labHeading:typeof HEADINGS[number]='d45';labPaused=false;labSpeed=1;notifyLog:string[]=[];
  labSprite:ActorSprite;secondSprite:ActorSprite;labAnimator:Animator;overlay=new T.Group();overlayOwned:{dispose:()=>void}[]=[];frameMap=new Map<string,Frame>();
  lastLabOverlay='';background='dark';
  constructor(public canvas:HTMLCanvasElement,public manifest:Manifest,public textures:Map<string,T.Texture>){
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.setPixelRatio(contract.pixelRatioCap);this.renderer.setClearColor(0x151923);
    if(this.renderer.capabilities.maxTextureSize<Math.max(...manifest.pages.map(p=>Math.max(p.width,p.height))))throw new Error('GPU maximum texture size below compiled atlas dimensions');
    this.scene.add(new T.HemisphereLight(0xc5d4e1,0x392b30,2));const sun=new T.DirectionalLight(0xe9d2ac,2);sun.position.set(-4,8,3);this.scene.add(sun,this.light,this.room,this.calibration,this.overlay);
    const aimGeo=new T.RingGeometry(.16,.19,32),aimMat=new T.MeshBasicMaterial({color:0xe5bd77,transparent:true,opacity:.9,depthWrite:false});this.aim=new T.Mesh(aimGeo,aimMat);this.aim.rotation.x=-Math.PI/2;this.scene.add(this.aim);
    const c=manifest.asset.clips.walk!.d45!;
    this.labSprite=new ActorSprite('lab-a',manifest,textures,c);this.secondSprite=new ActorSprite('lab-b',manifest,textures,manifest.asset.clips.attack_sword_01!.d45!);this.labAnimator=this.labSprite.animator;
    this.scene.add(this.labSprite.mesh,this.secondSprite.mesh);this.frameMap=new Map(manifest.frames.map(f=>[f.id,f]));this.buildRoom();this.buildCalibration();this.resize();
  }
  ownedMesh(geometry:T.BufferGeometry,material:T.Material){this.roomOwned.push(geometry,material);return new T.Mesh(geometry,material);}
  buildRoom(){
    const floor=this.ownedMesh(new T.PlaneGeometry(16,16),new T.MeshStandardMaterial({color:0x34434a,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;this.room.add(floor);
    const tileGeo=new T.BoxGeometry(.95,.025,.95),tileMat=new T.MeshStandardMaterial({color:0x3e4e53,roughness:1});this.roomOwned.push(tileGeo,tileMat);
    const tiles=new T.InstancedMesh(tileGeo,tileMat,225),matrix=new T.Matrix4();let n=0;for(let x=-7;x<=7;x++)for(let z=-7;z<=7;z++){matrix.makeTranslation(x,-.006,z);tiles.setMatrixAt(n++,matrix);}this.room.add(tiles);
    for(const p of props){
      const material=new T.MeshStandardMaterial({color:p.kind==='tree'?0x495452:0x6b6770,roughness:1});
      const geometry=p.kind==='wall'?new T.BoxGeometry(1.4,p.height,.6):new T.CylinderGeometry(p.radius*.85,p.radius,p.height,6);
      const base=this.ownedMesh(geometry,material) as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;base.position.set(p.x,p.height/2,p.z);base.userData.foot={x:p.x,z:p.z};base.userData.id=p.id;this.fadeMeshes.push(base);this.room.add(base);
      if(p.kind==='tree'||p.kind==='foreground'){
        const crown=this.ownedMesh(new T.IcosahedronGeometry(1.1,0),new T.MeshStandardMaterial({color:p.kind==='tree'?0x43524c:0x55414c,roughness:1})) as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
        crown.position.set(p.x,p.height,p.z);crown.scale.set(1.35,.48,1.1);crown.userData.foot={x:p.x,z:p.z};this.fadeMeshes.push(crown);this.room.add(crown);
      }else if(p.kind==='pillar'){
        const cap=this.ownedMesh(new T.CylinderGeometry(.65,.65,.18,6),new T.MeshStandardMaterial({color:0x97908c,roughness:1}));cap.position.set(p.x,p.height,p.z);this.room.add(cap);
      }
    }
    for(const [x,z,sx,sz] of [[0,-7.5,15,.22],[-7.5,0,.22,15]] as const){const wall=this.ownedMesh(new T.BoxGeometry(sx,1,sz),new T.MeshStandardMaterial({color:0x4d5260}));wall.position.set(x,.5,z);this.room.add(wall);}
    // Readable exit shrine, kept as simple opaque geometry.
    const shrine=this.ownedMesh(new T.TorusGeometry(.6,.08,6,24),new T.MeshStandardMaterial({color:0xd2ac63,emissive:0x7b461f,emissiveIntensity:.4}));shrine.position.set(0,1,-6.5);this.room.add(shrine);
    const grid=new T.GridHelper(15,15,0x627277,0x3f535b);grid.position.y=.012;this.room.add(grid);this.roomOwned.push(grid.geometry,...(Array.isArray(grid.material)?grid.material:[grid.material]));
  }
  disposeRoom(){for(const v of this.actors.values()){v.sprite.dispose();v.shadow.geometry.dispose();v.shadow.material.dispose();v.ring.geometry.dispose();(v.ring.material as T.Material).dispose();}this.actors.clear();for(const r of this.roomOwned)r.dispose();this.roomOwned=[];this.room.clear();this.fadeMeshes=[];}
  resetRoom(){this.disposeRoom();this.buildRoom();}
  buildCalibration(){
    this.calibration.add(new T.GridHelper(14,14,0xbfae82,0x58626b));const cube=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshStandardMaterial({color:0xc8bca4}));cube.position.set(-2,.5,-2);this.calibration.add(cube);
    for(const [dir,color] of [[new T.Vector3(1,0,0),0xe28176],[new T.Vector3(0,1,0),0xa4c47b],[new T.Vector3(0,0,1),0x81b1dd]] as const)this.calibration.add(new T.ArrowHelper(dir,new T.Vector3(-4,0,0),2,color));
    for(let i=0;i<8;i++){const yaw=i*Math.PI/4,dir=new T.Vector3(Math.sin(yaw),0,Math.cos(yaw));this.calibration.add(new T.ArrowHelper(dir,new T.Vector3(0,.03,0),2.5,0xe4be76));}
    for(const [color,x] of [[0x808080,-4],[0xe9bc67,-3],[0x263b4a,-2]] as const){const m=new T.Mesh(new T.PlaneGeometry(.65,.65),new T.MeshBasicMaterial({color,toneMapped:false}));m.quaternion.copy(this.camera.quaternion);m.position.set(x,2,1);this.calibration.add(m);}
  }
  getClip(id:string,dir:typeof HEADINGS[number]):Clip {const exact=this.manifest.asset.clips[id]?.[dir];if(exact)return exact;const fallback=this.manifest.asset.fallbacks[id];if(fallback){console.warn(`Explicit development fallback ${id} -> ${fallback}`);return this.manifest.asset.clips[fallback]![dir]!;}throw new Error(`required clip unavailable: ${id}/${dir}`);}
  createVisual(a:Actor){
    const sprite=new ActorSprite(String(a.id),this.manifest,this.textures,this.getClip('idle','d45'));sprite.material.color.set(a.kind==='enemy'?0xbd8d88:0xffffff);
    const shadow=new T.Mesh(new T.CircleGeometry(this.manifest.asset.shadow.radius,32),new T.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.3,depthWrite:false}));shadow.rotation.x=-Math.PI/2;
    const ring=new T.Mesh(new T.RingGeometry(tuning.heroRadius,tuning.heroRadius+.025,24),new T.MeshBasicMaterial({color:a.kind==='hero'?0xd1ba7c:0xc1645f,transparent:true,opacity:.5,depthWrite:false}));ring.rotation.x=-Math.PI/2;
    this.room.add(sprite.mesh,shadow,ring);const v={sprite,shadow,ring,tag:'',heading:'d45' as const};this.actors.set(a.id,v);return v;
  }
  setMode(mode:Mode){this.mode=mode;this.lastLabOverlay='';}
  update(sim:Simulation,alpha:number,ms:number,aim:{x:number;z:number}){
    const lab=this.mode==='animation'||this.mode==='calibration';this.room.visible=!lab;this.calibration.visible=lab;this.labSprite.mesh.visible=lab;this.secondSprite.mesh.visible=this.mode==='animation';this.overlay.visible=lab&&this.debug;
    this.renderer.setClearColor(this.background==='light'?0xd1c9b4:0x151923);this.aim.visible=!lab;this.aim.position.set(aim.x,.035,aim.z);
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
      for(const a of sim.actors){const v=this.actors.get(a.id)??this.createVisual(a),heading=selectDirection(a.yaw,v.heading),id=clipForState[a.state],tag=`${id}:${heading}:${a.action}`;
        if(tag!==v.tag){const old=v.sprite.animator.time;v.sprite.animator.start(this.getClip(id,heading));if(a.state==='walk'||a.state==='idle')v.sprite.animator.seek(old);v.tag=tag;v.heading=heading;}
        const clip=v.sprite.animator.clip;
        if(['attack','ability','dodge','hurt','death'].includes(a.state))v.sprite.animator.seek(a.age/60*1000);
        else v.sprite.animator.advance(ms);
        const foot=new T.Vector3(a.px+(a.x-a.px)*alpha,.025,a.pz+(a.z-a.pz)*alpha);v.sprite.show(v.sprite.animator.frame,foot,this.camera);
        v.shadow.position.set(foot.x,.03,foot.z);v.shadow.visible=a.health>0;v.ring.position.set(foot.x,.035,foot.z);v.ring.visible=this.debug||(a.kind==='enemy'&&a.state==='attack');
        if(a.kind==='enemy'&&a.state==='attack'){v.ring.scale.setScalar(1+a.age/tuning.enemy.windup*2);(v.ring.material as T.MeshBasicMaterial).color.set(a.age<tuning.enemy.windup?0xc66e55:0xe5c37d);}else v.ring.scale.setScalar(1);
      }
      this.light.position.set(sim.hero.x-.25,.85,sim.hero.z);this.light.intensity=sim.hero.state==='ability'?14:5;
      for(const m of this.fadeMeshes){const p=m.userData.foot as{x:number;z:number},delta=new T.Vector3(sim.hero.x-p.x,0,sim.hero.z-p.z);const fade=delta.length()<1.65&&delta.dot(outward)<0;
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
  resize(scale=contract.renderScale){const width=this.canvas.clientWidth,height=this.canvas.clientHeight;this.renderer.setSize(Math.round(width*scale),Math.round(height*scale),false);resizeCamera(this.camera,width,height);}
  async warm(){for(const texture of this.textures.values())this.renderer.initTexture(texture);await this.renderer.compileAsync(this.scene,this.camera);this.renderer.render(this.scene,this.camera);}
  stats(){const size=this.renderer.getDrawingBufferSize(new T.Vector2());return{buffer:size.toArray(),logical:[this.canvas.clientWidth,this.canvas.clientHeight],devicePixelRatio,renderScale:size.y/this.canvas.clientHeight,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,objects:{...this.renderer.info.memory},atlasBytes:this.manifest.pages.reduce((s,p)=>s+p.rgbaBytes,0),fileBytes:this.manifest.pages.reduce((s,p)=>s+p.bytes,0),actors:this.actors.size,webgl:this.renderer.getContext().getParameter(this.renderer.getContext().VERSION),gpu:this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')?this.renderer.getContext().getParameter(this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL):'unavailable'};}
  dispose(){this.disposeRoom();this.labSprite.dispose();this.secondSprite.dispose();this.overlayOwned.forEach(v=>v.dispose());this.calibration.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments||o instanceof T.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.aim.geometry.dispose();(this.aim.material as T.Material).dispose();this.renderer.dispose();}
}
