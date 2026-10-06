import fs from 'node:fs/promises';
import path from 'node:path';
import {parseGame,SettingsSchema,type LoadResult} from '../src/core/save';
export type Slot='settings'|'game';
export function parseSlot(slot:Slot,value:unknown){return slot==='game'?parseGame(value):SettingsSchema.parse(value);}
export function validateRequest(slot:Slot,value:unknown){if(!['game','settings'].includes(slot))throw new Error('unknown app-owned slot');const text=JSON.stringify(value);if(!text||Buffer.byteLength(text)>16384)throw new Error('save payload exceeds 16 KiB');return parseSlot(slot,value);}
export class Store {
  queue:Promise<void>=Promise.resolve();
  constructor(public directory:string){}
  async load(slot:Slot):Promise<LoadResult<ReturnType<typeof parseSlot>>>{
    await this.queue;let exists=false;
    for(const suffix of ['.json','.bak'])try{
      const file=path.join(this.directory,slot+suffix),stat=await fs.stat(file);exists=true;if(stat.size>16384)throw new Error('oversized');
      const data=parseSlot(slot,JSON.parse(await fs.readFile(file,'utf8')));return{status:suffix==='.json'?'ok':'recovered',data};
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')exists=true;}
    return exists?{status:'unreadable',message:'No readable primary/backup save. Files preserved; automatic overwrite disabled.'}:{status:'empty'};
  }
  save(slot:Slot,value:unknown){
    const validated=validateRequest(slot,value);
    const write=async()=>{
      await fs.mkdir(this.directory,{recursive:true});
      // Reads preserve unreadable state. Explicit writes also fail closed until manual recovery.
      const file=path.join(this.directory,slot+'.json');
      try{const old=await fs.readFile(file,'utf8');try{parseSlot(slot,JSON.parse(old));await fs.writeFile(file+'.bak.tmp',old);await fs.rename(file+'.bak.tmp',path.join(this.directory,slot+'.bak'));}
        catch{const recovered=await fs.readFile(path.join(this.directory,slot+'.bak'),'utf8');parseSlot(slot,JSON.parse(recovered));await fs.copyFile(file,path.join(this.directory,slot+'.corrupt'));}
      }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Unreadable save preserved; restore a valid backup before writing.');}
      const temp=file+'.tmp',handle=await fs.open(temp,'w',0o600);try{await handle.writeFile(JSON.stringify(validated));await handle.sync();}finally{await handle.close();}
      await fs.rename(temp,file); // same-directory atomic replace, Windows/macOS; queue prevents racing temp names
    };
    const result=this.queue.then(write);this.queue=result.catch(()=>{});return result;
  }
}
