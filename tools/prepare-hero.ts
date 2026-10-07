import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeAsset,readAsset} from './assets/io';
import {readLibrarySource} from './assets/sources';
import {compile,hash} from './compiler';
import {parseSource,type Source} from '../src/assets/schema';
import {heroTimings} from '../src/content/hero-actions';
type Registration={canvas:[number,number];anchor:[number,number];density:number};
type Record={id:string;group:string;member:string;sha256:string;registration:Registration};
const check=process.argv.includes('--check');
const {stdout}=await promisify(execFile)('python3',['-B','tools/assets/hero.py'],{maxBuffer:4*1024*1024});
const handoff=JSON.parse(stdout) as {frames:Record[];clips:{id:string;heading:string;frames:string[];durationsMs:number[];loop:boolean;notifies:[]}[];timings:unknown;limitations:string[];handoffSha256:string};
if(JSON.stringify(handoff.timings)!==JSON.stringify(heroTimings))throw new Error('Hero action recipe differs from pinned handoff');
async function write(file:string,data:string|Buffer){
 if(check){if(!Buffer.from(data).equals(await readAsset(file)))throw new Error('Stale hero preparation: '+file);}
 else await writeAsset(file,data);
}
const legacy=JSON.parse(await readAsset('staging/ink/ink-hero.json','utf8')) as Source;
const asset:Source['asset']={...legacy.asset,id:'ink-hero-current',contentVersion:'hero-test-20261007-v02',viewMode:'four-directional',
 canvas:[632,688],anchor:[301,556],density:350,atlasSize:2048,
 limitations:['TEST selection; approximate registration and action joins require gameplay review.',...handoff.limitations],
 provenance:{...legacy.asset.provenance,source:'hero-handoff / '+handoff.handoffSha256},
 recipe:'prepare-hero-v1 / native held drawings',requiredClips:[],clips:{}};
const source:Source={schemaVersion:2,asset,frames:[]};
for(const record of handoff.frames){
 const data=await readLibrarySource(record.member,record.group);if(hash(data)!==record.sha256)throw new Error('Hero source changed: '+record.id);
 const file=`ink/ink-hero-current/${record.id}.png`;await write('staging/'+file,data);
 source.frames.push({id:record.id,path:file,origin:'imported-study',attachments:{},registration:record.registration});
}
for(const clip of handoff.clips){
 const {id,heading,...timing}=clip;
 (asset.clips[id]??={})[heading as keyof typeof asset.clips[string]]=timing;
}
asset.requiredClips=Object.keys(asset.clips);parseSource(source);
await write('staging/ink/ink-hero-current.json',JSON.stringify(source,null,2)+'\n');
await write('staging/ink/hero-receipt.json',JSON.stringify({handoffSha256:handoff.handoffSha256,frames:handoff.frames},null,2)+'\n');
const manifest=await compile('ink/ink-hero-current.json','public/generated/ink/ink-hero-current',false,check);
if(check){const previous=await readAsset('public/generated/ink/ink-hero-current/manifest.json','utf8');if(JSON.stringify(JSON.parse(previous))!==JSON.stringify(manifest))throw new Error('Stale hero atlas');}
console.log(`${check?'Verified':'Prepared'} current hero: ${source.frames.length} native frames / ${manifest.pages.length} pages.`);
