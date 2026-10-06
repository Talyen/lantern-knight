import {PlaneGeometry,MeshBasicMaterial,Mesh,BufferAttribute,Vector3, type OrthographicCamera,type Texture} from 'three';
import {trimmedBounds} from '../core/camera';
import {Animator} from '../core/animation';
import type {Manifest,Frame,Clip} from '../assets/schema';
export class ActorSprite {
  geometry=new PlaneGeometry(1,1);
  material=new MeshBasicMaterial({alphaTest:.05,depthTest:true,depthWrite:true,transparent:false,toneMapped:false});
  mesh=new Mesh(this.geometry,this.material);animator:Animator;lastFrame='';frameIndex=new Map<string,Frame>();
  constructor(public id:string,public manifest:Manifest,public textures:Map<string,Texture>,clip:Clip){this.animator=new Animator(id,clip);this.frameIndex=new Map(manifest.frames.map(f=>[f.id,f]));this.mesh.frustumCulled=false;}
  show(frameId:string,foot:Vector3,camera:OrthographicCamera){
    const f=this.frameIndex.get(frameId);if(!f)throw new Error(`runtime required frame missing: ${frameId}`);
    if(frameId!==this.lastFrame){
      const texture=this.textures.get(f.page);if(!texture)throw new Error(`runtime page missing: ${f.page}`);this.material.map=texture;this.material.needsUpdate=this.lastFrame==='';
      const b=trimmedBounds({density:this.manifest.asset.density,anchor:this.manifest.asset.anchor},f.trim);
      const pos=this.geometry.getAttribute('position') as BufferAttribute;
      pos.setXYZ(0,b.left,b.top,0);pos.setXYZ(1,b.right,b.top,0);pos.setXYZ(2,b.left,b.bottom,0);pos.setXYZ(3,b.right,b.bottom,0);pos.needsUpdate=true;
      const p=this.manifest.pages.find(p=>p.id===f.page)!,[x,y,w,h]=f.rect,uv=this.geometry.getAttribute('uv') as BufferAttribute;
      uv.setXY(0,x/p.width,1-y/p.height);uv.setXY(1,(x+w)/p.width,1-y/p.height);uv.setXY(2,x/p.width,1-(y+h)/p.height);uv.setXY(3,(x+w)/p.width,1-(y+h)/p.height);uv.needsUpdate=true;
      this.geometry.computeBoundingSphere();this.lastFrame=frameId;
    }
    this.mesh.position.copy(foot);this.mesh.quaternion.copy(camera.quaternion);return f;
  }
  dispose(){this.geometry.dispose();this.material.dispose();this.mesh.removeFromParent();}
}
