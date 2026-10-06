import fs from 'node:fs/promises';
import {contract} from '../src/core/camera';
import {swordCombo} from '../src/content/gameplay';
import {parseSource} from '../src/assets/schema';
const historical=JSON.parse(await fs.readFile('docs/history/camera-v1-proxy.json','utf8'));
const error=192*3*Math.abs(historical.elevationDeg-contract.elevationDeg)*Math.PI/180;
if(error>.001||Math.abs(historical.azimuthDeg-contract.azimuthDeg)>1e-6)throw new Error('Existing placeholders require a real re-bake for this orientation change.');
for(const file of ['staging/source.json','staging/diagnostic-source.json']){
  const data=JSON.parse(await fs.readFile(file,'utf8'));data.schemaVersion=2;data.asset.schemaVersion=2;
  for(const [id,dirs]of Object.entries({...data.asset.clips}) as [string,unknown][]){if(id.startsWith('enemy_')||id==='attack_sword_02'||id==='attack_sword_03')continue;data.asset.clips['enemy_'+id]=structuredClone(dirs);if(!data.asset.requiredClips.includes('enemy_'+id))data.asset.requiredClips.push('enemy_'+id);}
  Object.assign(data.asset,{contractId:contract.id,bakeVersion:contract.bakeVersion,contentVersion:'0.2.0-diagnostic',status:'diagnostic',designReference:'engineering-placeholder',renderStyle:'diagnostic',recipe:'existing-placeholder-revalidation-v2',legacyBake:{contractId:historical.id,bakeVersion:historical.bakeVersion,azimuthDeg:historical.azimuthDeg,elevationDeg:historical.elevationDeg,maxProjectionErrorPx:error,reason:'Existing engineering frames retained unchanged tonight; only sub-micro-pixel angle precision changed. Span is presentation framing. These are not the canonical Rust/Clean INK hero.'}});
  for(let i=1;i<3;i++){
    const stage=swordCombo[i]!,base=data.asset.clips.attack_sword_01;
    data.asset.clips[stage.clip]=structuredClone(base);
    for(const c of Object.values(data.asset.clips[stage.clip]) as {durationsMs:number[];notifies:{atMs:number}[]}[]){const ratio=stage.total/36;c.durationsMs=c.durationsMs.map(ms=>ms*ratio);c.notifies=c.notifies.map(n=>({...n,atMs:n.atMs*ratio}));}
    if(!data.asset.requiredClips.includes(stage.clip))data.asset.requiredClips.push(stage.clip);
  }
  parseSource(data);await fs.writeFile(file,JSON.stringify(data,null,2));
}
for(const file of ['valid','invalid-duration','invalid-camera','invalid-heading']){
  const path=`staging/fixtures/${file}.json`,data=JSON.parse(await fs.readFile(path,'utf8'));
  data.schemaVersion=2;data.asset.schemaVersion=2;data.asset.contractId=file==='invalid-camera'?'unapproved-other-camera':contract.id;data.asset.bakeVersion=contract.bakeVersion;data.asset.designReference='engineering-placeholder';data.asset.renderStyle='diagnostic';
  await fs.writeFile(path,JSON.stringify(data,null,2));
}
console.log(`Existing PNGs unchanged. Camera v2 precision difference <= ${error} source pixels. Stages 02/03 explicitly reuse placeholder drawings.`);
