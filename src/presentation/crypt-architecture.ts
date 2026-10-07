import * as T from 'three';
import type {PackLease} from '../assets/loader';
import type {WorldVisualDefinition,SiteWall} from '../content/world-art';
import type {AreaDefinition} from '../content/world';
import {heightAt} from '../content/world';
import type {OcclusionFades} from './occlusion-fades';

export class CryptArchitecture {
 readonly parts:T.Mesh[]=[];readonly owned:{dispose():void}[]=[];textureBytes=0;
 private textures=new Map<string,T.Texture>();
 constructor(private area:AreaDefinition,private art:WorldVisualDefinition,private packs:Map<string,PackLease>,private room:T.Group,private fades:OcclusionFades){}
 texture(id:string){let t=this.textures.get(id);if(t)return t;const p=this.packs.get(id)!;
  // Mips are safe only for an entire standalone material page, never packed cutouts.
  const f=p.manifest.frames[0]!,page=p.manifest.pages.find(v=>v.id===f.page)!;
  if(p.manifest.asset.type!=='material'||f.rect.join()!==[0,0,page.width,page.height].join())throw new Error(`repeatable surface must own its complete page: ${id}`);
  t=page.mipmaps?p.textures.get(f.page)!:p.textures.get(f.page)!.clone();t.wrapS=t.wrapT=T.RepeatWrapping;t.generateMipmaps=true;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.anisotropy=4;t.needsUpdate=true;this.textures.set(id,t);if(!page.mipmaps){this.owned.push(t);this.textureBytes+=Math.ceil(page.rgbaBytes*4/3);}return t;
 }
 floorMaterial(){const m=new T.MeshBasicMaterial({map:this.texture('ink-crypt-stone'),depthWrite:false,toneMapped:false});
  m.onBeforeCompile=s=>{
   s.uniforms.cryptDamp={value:this.texture('ink-crypt-damp')};s.uniforms.cryptMarble={value:this.texture('ink-crypt-marble')};
   s.vertexShader='varying vec3 cryptWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ncryptWorld=(modelMatrix*vec4(position,1.)).xyz;');
   s.fragmentShader='varying vec3 cryptWorld;uniform sampler2D cryptDamp,cryptMarble;\n'+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`
    vec2 q=cryptWorld.xz;vec3 stone=texture2D(map,vec2(q.x,-q.y)/4.).rgb;stone=mix(stone,vec3(.12,.14,.16),.12);
    vec3 damp=texture2D(cryptDamp,vec2(q.x,-q.y)/4.).rgb;
    vec3 marble=texture2D(cryptMarble,vec2(q.x,-q.y)/4.).rgb;
    float side=smoothstep(3.4,3.55,abs(q.x));
    float sanctuary=(1.-smoothstep(2.30,2.34,abs(q.x)))*(1.-smoothstep(-5.7,-5.65,q.y));
    vec3 color=mix(stone*vec3(.58,.65,.70),damp*.78,side);color=mix(color,marble*vec3(.67,.66,.61),sanctuary);
    float boundary=min(8.-abs(q.x),9.-abs(q.y));float roomMask=smoothstep(-.01,.01,boundary);
    float baseShade=mix(.65,1.,smoothstep(.1,1.,boundary));color*=baseShade;
    diffuseColor*=vec4(mix(vec3(.008,.012,.017),color,roomMask),1.);
   `);
  };m.customProgramCacheKey=()=> 'crypt-ground-v1';return m;
 }
 private material(tint:number){const m=new T.MeshBasicMaterial({map:this.texture('ink-masonry'),color:tint,side:T.DoubleSide,toneMapped:false});this.owned.push(m);return m;}
 private mesh(id:string,g:T.PlaneGeometry,m:T.MeshBasicMaterial,role:string){const mesh=new T.Mesh(g,m);mesh.userData.artPart={id,role};this.parts.push(mesh);this.room.add(mesh);this.owned.push(g);return mesh;}
 build(){
  const face=this.material(0x8b9498),cap=this.material(0xb3b8b4);
  for(const w of this.art.walls){const dx=w.to.x-w.from.x,dz=w.to.z-w.from.z,length=Math.hypot(dx,dz),y=heightAt(this.area,w.from.x,w.from.z);
   const normal=w.id==='crypt-west'?new T.Vector3(1,0,0):w.id==='crypt-rear'?new T.Vector3(0,0,1):w.id.startsWith('crypt-east')?new T.Vector3(-1,0,0):new T.Vector3(0,0,-1);
   const center=new T.Vector3((w.from.x+w.to.x)/2,y+w.height/2,(w.from.z+w.to.z)/2).addScaledVector(normal,w.thickness/2);
   const g=new T.PlaneGeometry(length,w.height),uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*length/2.4,uv.getY(i)*w.height/1.2);
   const normals=g.getAttribute('normal'),yaw=Math.atan2(-dz,dx);if(new T.Vector3(Math.sin(yaw),0,Math.cos(yaw)).dot(normal)<0)for(let i=0;i<normals.count;i++)normals.setZ(i,-1);
   const f=this.mesh(`${w.id}-face`,g,face.clone(),'wall-face');this.owned.push(f.material);f.position.copy(center);f.rotation.y=Math.atan2(-dz,dx);f.userData.siteWall=w.id;f.userData.noCastShadow=!!w.fade;f.userData.artPart.assembly=w.assembly;
   const lengthCap=length-w.thickness,topGeo=new T.PlaneGeometry(lengthCap,w.thickness),topUV=topGeo.getAttribute('uv');for(let i=0;i<topUV.count;i++)topUV.setXY(i,topUV.getX(i)*lengthCap/2.4,topUV.getY(i)*w.thickness/1.2);
   const top=this.mesh(`${w.id}-cap`,topGeo,cap.clone(),'wall-cap');this.owned.push(top.material);top.position.set((w.from.x+w.to.x)/2,y+w.height,(w.from.z+w.to.z)/2);top.rotation.set(-Math.PI/2,0,Math.atan2(-dz,dx));top.userData.artPart.assembly=w.assembly;top.userData.noCastShadow=!!w.fade;
   // Caps stop short of junctions; one horizontal plate owns each shared endpoint.
   if(w.fade){this.fades.add(f,w.assembly,w);this.fades.add(top,w.assembly,w);}
  }
  const corners=new Map<string,{x:number;z:number;height:number;wall:SiteWall}>();
  for(const w of this.art.walls)for(const v of [w.from,w.to]){const key=`${v.x}:${v.z}`,old=corners.get(key);if(!old||old.height<w.height)corners.set(key,{...v,height:w.height,wall:w});}
  for(const [key,c]of corners){const g=new T.PlaneGeometry(c.wall.thickness,c.wall.thickness),uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*c.wall.thickness/2.4,uv.getY(i)*c.wall.thickness/1.2);const m=this.mesh(`crypt-junction-${key}`,g,cap.clone(),'wall-cap');this.owned.push(m.material);m.rotation.x=-Math.PI/2;m.position.set(c.x,heightAt(this.area,c.x,c.z)+c.height,c.z);if(c.wall.fade)this.fades.add(m,c.wall.assembly,c.wall);}
 }
 dispose(){for(const o of this.owned)o.dispose();this.owned.length=0;this.textures.clear();this.parts.length=0;}
}
