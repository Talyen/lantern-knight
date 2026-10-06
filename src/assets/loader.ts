import { Texture,SRGBColorSpace,LinearFilter } from 'three';
import {parseManifest,type Manifest} from './schema';
type Entry<T>={refs:number;promise:Promise<T>;value?:T;dispose:(value:T)=>void};
export class ResourcePool<T> {
  entries=new Map<string,Entry<T>>();
  constructor(private load:(id:string)=>Promise<T>,private dispose:(value:T)=>void){}
  retain(id:string){
    let entry=this.entries.get(id);
    if(!entry){const created={refs:0,dispose:this.dispose} as Entry<T>;entry=created;
      created.promise=this.load(id).then(value=>{created.value=value;if(created.refs===0){created.dispose(value);if(this.entries.get(id)===created)this.entries.delete(id);}return value;},error=>{if(this.entries.get(id)===created)this.entries.delete(id);throw error;});
      this.entries.set(id,created);
    }
    entry.refs++;const held=entry;let released=false;
    return {promise:entry.promise,release:()=>{if(released)return;released=true;held.refs--;if(held.refs===0&&held.value){held.dispose(held.value);if(this.entries.get(id)===held)this.entries.delete(id);}}};
  }
  async acquire(ids:string[],signal?:AbortSignal,onProgress?:(done:number,total:number)=>void){
    if(signal?.aborted)throw new Error('load cancelled');
    const leases=[...new Set(ids)].map(id=>[id,this.retain(id)] as const);let released=false;
    const release=()=>{if(released)return;released=true;leases.forEach(([,l])=>l.release());};
    const abort=()=>release();signal?.addEventListener('abort',abort,{once:true});
    let done=0;
    try{const results=await Promise.all(leases.map(async([id,l])=>{const value=await l.promise;onProgress?.(++done,leases.length);return[id,value] as const;}));
      if(signal?.aborted)throw new Error('load cancelled');
      return {resources:new Map(results),release};
    }catch(error){release();throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
}
export class AssetLoader {
  constructor(public manifest:Manifest){}
  pool=new ResourcePool<Texture>(async id=>{
    const p=this.manifest.pages.find(p=>p.id===id);if(!p)throw new Error(`missing required page ${id}`);
    const response=await fetch(`/generated/${p.path}`);if(!response.ok)throw new Error(`${p.path}: HTTP ${response.status}`);
    const buffer=await response.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==p.hash)throw new Error(`${p.path}: hash mismatch`);
    const bitmap=await createImageBitmap(new Blob([buffer],{type:'image/png'}),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
    if(bitmap.width!==p.width||bitmap.height!==p.height){bitmap.close();throw new Error(`${p.path}: wrong image dimensions`);}
    const texture=new Texture(bitmap);texture.colorSpace=SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=LinearFilter;texture.magFilter=LinearFilter;texture.flipY=false;texture.premultiplyAlpha=false;texture.needsUpdate=true;return texture;
  },texture=>{(texture.image as ImageBitmap).close();texture.dispose();});
  load(bundle:string,signal?:AbortSignal,progress?:(done:number,total:number)=>void){
    const collect=(id:string,seen=new Set<string>()):string[]=>{if(seen.has(id))return[];seen.add(id);const b=this.manifest.bundles[id];if(!b)throw new Error(`unknown bundle ${id}`);return[...b.required,...b.dependencies.flatMap(d=>collect(d,seen))];};
    return this.pool.acquire(collect(bundle),signal,progress);
  }
  static async open(){const r=await fetch('/generated/manifest.json');if(!r.ok)throw new Error('manifest unavailable; run npm run assets:compile');return new AssetLoader(parseManifest(await r.json()));}
}
