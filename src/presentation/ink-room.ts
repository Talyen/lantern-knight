import type {PreparedRegistration} from '../assets/registration';
import * as T from 'three';
import {ActorSprite} from './sprite';
import {OcclusionFades} from './occlusion-fades';
import {CryptArchitecture} from './crypt-architecture';
import {GraveyardRoom} from './graveyard-room';
import {resolveClip,type Clip} from '../assets/schema';
import type {PackLease} from '../assets/loader';
import {worldVisuals,type ArtPlacement} from '../content/world-art';
import {heightAt,type AreaDefinition} from '../content/world';
import {outward} from '../core/camera';
import {clipDuration,frameAt} from '../core/animation';
import type {Simulation} from '../core/simulation';

export class InkRoom {
 readonly sprites:ActorSprite[]=[];
 readonly fades:ActorSprite[]=[];
 readonly effects=new Map<string,ActorSprite>();
 readonly occlusion=new OcclusionFades();
 readonly architecture:CryptArchitecture|undefined;
 readonly graveyard:GraveyardRoom|undefined;
 private time=0;
 get ambientTime(){return this.time/1000;}
 private flames:{fixture:ActorSprite;emission:ActorSprite;placement:ArtPlacement}[]=[];
 private gates:{sprite:ActorSprite;seal:ActorSprite;x:number;z:number}[]=[];
 constructor(readonly area:AreaDefinition,private packs:Map<string,PackLease>,private room:T.Group,private camera:T.OrthographicCamera,private shadowTexture:T.Texture|undefined,readonly registration:PreparedRegistration){const art=worldVisuals[area.id];if(art?.interior)this.architecture=new CryptArchitecture(area,art,packs,room,this.occlusion);if(area.id==='court')this.graveyard=new GraveyardRoom(area,packs,room,camera,this.sprites,this.fades,shadowTexture,registration.coverage);}
 private sprite(id:string,asset:string,clip:string){const p=this.packs.get(asset);if(!p)throw new Error(`room art not acquired: ${asset}`);
  const s=new ActorSprite(id,p.manifest,p.textures,resolveClip(p.manifest,clip,'d45'));this.sprites.push(s);this.room.add(s.mesh);return s;
 }
 floorMaterial(){if(this.graveyard)return this.graveyard.floorMaterial();if(this.architecture)return this.architecture.floorMaterial();throw new Error(`No authored floor architecture for ${this.area.id}`);}
 private owned:{dispose:()=>void}[]=[];
 private castShadows:{sprite:ActorSprite;mesh:T.Mesh<T.BufferGeometry,T.MeshBasicMaterial>}[]=[];
 private staticShadows:T.Mesh<T.PlaneGeometry,T.MeshBasicMaterial>[]=[];
 // Active interiors use authored painted architecture.
 private walls(){this.architecture?.build();}

 private ground(p:ArtPlacement,asset=p.asset??(p.clip.startsWith('t')?'ink-ground-transitions':'ink-decals')){
  const s=this.sprite(p.id,asset,p.clip),scale=p.scale??1,angle=p.rotation??0;
  s.show(s.animator.frame,new T.Vector3(p.x,heightAt(this.area,p.x,p.z)+.018,p.z),this.camera);s.mesh.scale.setScalar(scale);s.mesh.rotateZ(angle);s.mesh.renderOrder=-1.9;s.material.color.set(p.tint??0xb7c2b6);s.material.opacity=p.opacity??1;
  const vertices=s.geometry.getAttribute('position'),c=Math.cos(angle),sn=Math.sin(angle);
  for(let i=0;i<vertices.count;i++){const lx=vertices.getX(i)*scale,ly=vertices.getY(i)*scale,x=p.x+lx*c-ly*sn,z=p.z-lx*sn-ly*c;vertices.setZ(i,(heightAt(this.area,x,z)-heightAt(this.area,p.x,p.z))/scale);}
  vertices.needsUpdate=true;return s;
 }
 private pathEdges(){const art=worldVisuals[this.area.id]!;
  for(const [pi,path]of art.paths.entries())for(let i=1;i<path.points.length;i++){const from=path.points[i-1]!,to=path.points[i]!,dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz),n=Math.ceil(length/1.7);
   for(const side of [-1,1])for(let j=0;j<n;j++){const t=(j+.5)/n,x=from.x+dx*t-dz/length*path.width/2*side,z=from.z+dz*t+dx/length*path.width/2*side;
    this.ground({id:`path-edge-${pi}-${i}-${side}-${j}`,clip:'t03_broken_pavement_edge',x,z,scale:.44,rotation:Math.atan2(-dz,dx),tint:0xbfc8bd});
   }
  }
 }
 build(){if(this.graveyard){this.graveyard.build();return;}const art=worldVisuals[this.area.id]!;
  this.walls();this.pathEdges();
  for(const plot of art.graves)this.ground({id:`soil-${plot.id}`,clip:'grave-soil',asset:'ink-soil',x:plot.x,z:plot.z,scale:plot.age==='old'?.94:1,tint:0xc3c7b7});
  for(const p of art.props)this.place(p);
  for(const p of art.decals)this.ground(p);
 }
 private place(p:ArtPlacement){const s=this.sprite(p.id,p.asset??'ink-scenery',p.clip),scale=p.scale??1;
  s.show(s.animator.frame,new T.Vector3(p.x,heightAt(this.area,p.x,p.z)+(p.y??0),p.z),this.camera);s.mesh.scale.set(scale*(p.mirror?-1:1),scale,scale);
  if(p.tint){s.material.color.set(p.tint);s.edgeMaterial?.color.copy(s.material.color);}
  // Reversible runtime matte rejects generated backdrop residue without changing sources.

  s.mesh.userData.artPart={id:p.id,role:p.wallFace?'mounted-face':p.mount?'mounted-fixture':'prop',assembly:p.assembly,mount:p.mount,footprint:p.footprint};
  if(p.wallFace){const wall=worldVisuals[this.area.id]!.walls.find(w=>w.id===p.wallFace)!;s.mesh.rotation.y=Math.atan2(-(wall.to.z-wall.from.z),wall.to.x-wall.from.x);}
  if(p.fade){this.fades.push(s);this.occlusion.add(s.mesh,p.assembly??p.id);}
  if(p.flame){const candle=p.flame.clip==='votive',emission=this.sprite(p.id+'-flame',candle?'ink-crypt-flame':'ink-crypt-ambient',candle?'votive':'lamp_flame');emission.mesh.userData.emissive=true;emission.mesh.userData.decorative=true;this.flames.push({fixture:s,emission,placement:p});}
  if((p.shadow===undefined||p.shadow==='cast')&&!['lantern','cresset','votive','roots','fern','bramble'].includes(p.clip)){
   const g=s.geometry.clone(),position=g.getAttribute('position');s.mesh.updateMatrixWorld(true);
   for(let i=0;i<position.count;i++){const v=new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(s.mesh.matrixWorld),h=Math.max(0,v.y-heightAt(this.area,p.x,p.z));v.x+=h*.60;v.z+=h*.45;v.y=heightAt(this.area,v.x,v.z)+.012;position.setXYZ(i,v.x,v.y,v.z);}position.needsUpdate=true;g.computeBoundingSphere();
   const m=new T.MeshBasicMaterial({map:s.material.map,transparent:true,opacity:p.clip==='yew'?.22:.26,alphaTest:.8,depthWrite:false,side:T.DoubleSide,color:0x142122});m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#ifdef USE_MAP\ndiffuseColor.a*=texture2D(map,vMapUv).a;\n#endif');};m.customProgramCacheKey=()=> 'rest-silhouette-shadow-v1';
   const shadow=new T.Mesh(g,m);shadow.renderOrder=-1.5;this.room.add(shadow);shadow.userData.baseOpacity=m.opacity;this.castShadows.push({sprite:s,mesh:shadow});this.owned.push(g,m);
  }
  if(this.shadowTexture&&p.footprint&&p.shadow!=='none'){const shadow=new T.Mesh(new T.PlaneGeometry(...p.footprint),new T.MeshBasicMaterial({map:this.shadowTexture,transparent:true,depthTest:true,depthWrite:false,opacity:.32}));shadow.rotation.x=-Math.PI/2;shadow.position.set(p.x,heightAt(this.area,p.x,p.z)+.012,p.z);shadow.renderOrder=-1.5;this.room.add(shadow);shadow.userData.sprite=s;shadow.userData.baseOpacity=.32;this.staticShadows.push(shadow);}
  return s;
 }
 private effect(id:string,asset:string,clip:string){let s=this.effects.get(id);if(!s){s=this.sprite(id,asset,clip);s.mesh.renderOrder=-.5;this.effects.set(id,s);}return s;}
 private sample(s:ActorSprite,clip:Clip,time:number,foot:T.Vector3){s.show(frameAt(clip,time),foot,this.camera);}
 update(sim:Simulation,alpha:number,visible:boolean,ms=1000/60){for(const s of this.effects.values())s.mesh.visible=false;
  this.graveyard?.update(sim,alpha,ms);
  this.time+=Math.max(0,ms);this.occlusion.update(sim,alpha,ms);
  for(const cast of this.castShadows){cast.mesh.visible=cast.sprite.mesh.visible;cast.mesh.material.opacity=cast.mesh.userData.baseOpacity*cast.sprite.material.opacity;}
  for(const shadow of this.staticShadows){const sprite=shadow.userData.sprite as ActorSprite;shadow.visible=sprite.mesh.visible;shadow.material.opacity=shadow.userData.baseOpacity*sprite.material.opacity;}
  for(const {fixture,emission,placement:p}of this.flames){const candle=p.flame!.clip==='votive',clip=emission.animator.clip,foot=fixture.mesh.position.clone();
   if(!candle){foot.x-=.10;foot.y+=.25;foot.z+=.10;}
   foot.addScaledVector(outward,.008);this.sample(emission,clip,this.time+p.flame!.phase*1000,foot);emission.mesh.scale.setScalar((p.scale??1)*(candle?1:.38));emission.mesh.visible=visible;emission.material.opacity=fixture.material.opacity;
  }
  if(this.architecture&&visible){
   const motes=this.effect('crypt-motes','ink-crypt-ambient','rising_motes');motes.mesh.visible=true;motes.mesh.userData.decorative=true;motes.mesh.scale.setScalar(.28);motes.material.opacity=.32;this.sample(motes,motes.animator.clip,this.time+710,new T.Vector3(0,1.35,-6.87));
   const phase=this.time%9500;
   for(const [id,clipId,duration]of [['crypt-drop','droplet_splash',1000],['crypt-ripple','pond_ripple',2000]] as const){const effect=this.effect(id,'ink-crypt-ambient',clipId);effect.mesh.visible=phase<duration;effect.mesh.userData.decorative=true;effect.mesh.scale.setScalar(.2);effect.material.opacity=.5;this.sample(effect,effect.animator.clip,phase,new T.Vector3(6.6,heightAt(this.area,6.6,.3)+.025,.3));}
  }
  for(const g of this.gates){g.seal.mesh.visible=visible&&!sim.cleared;
   if(g.seal.mesh.visible){const c=resolveClip(g.seal.manifest,'door_seal_dissolve','d45');this.sample(g.seal,c,clipDuration(c)*.4,new T.Vector3(g.x,heightAt(this.area,g.x,g.z)+.02,g.z));}
  }
  if(!visible)return;

  for(const a of sim.enemies)if(a.health>0&&a.state==='attack'){
   const s=this.effect(`telegraph-${a.id}`,'ink-cues','enemy_ring'),c=resolveClip(s.manifest,'enemy_ring','d45');s.mesh.visible=true;
   // Ring radius follows authoritative reach; artwork is only a cue.
   s.mesh.scale.setScalar(a.definition.melee.range/2);this.sample(s,c,Math.min(.99,a.age/a.definition.melee.total)*clipDuration(c),new T.Vector3(a.px+(a.x-a.px)*alpha,a.y+.025,a.pz+(a.z-a.pz)*alpha));
  }
 }
 dispose(){this.graveyard?.dispose();this.architecture?.dispose();this.owned.forEach(v=>v.dispose());this.owned=[];for(const s of this.staticShadows){s.geometry.dispose();s.material.dispose();s.removeFromParent();}this.staticShadows=[];for(const s of this.sprites)s.dispose();this.effects.clear();}
}
