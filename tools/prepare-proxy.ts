import {readAsset,writeAsset,mkdirAsset} from './assets/io';
import {readLibrarySource} from './assets/sources';
import {parseSource} from '../src/assets/schema';
const source=parseSource(JSON.parse(await readAsset('staging/diagnostic-source.json','utf8'))),exported=JSON.parse((await readLibrarySource('export.json','foundation-proxy')).toString());
for(const frame of exported.frames){await mkdirAsset('staging/proxy',{recursive:true});await writeAsset('staging/'+frame.path,await readLibrarySource(frame.path.split('/').at(-1)!,'foundation-proxy'));}
source.asset.legacyBake={contractId:'lantern-camera-v1-proxy',bakeVersion:1,azimuthDeg:45,elevationDeg:35.2643897,maxProjectionErrorPx:1.7336915009241737e-7,reason:'Existing engineering frames retained unchanged tonight; only sub-micro-pixel angle precision changed. Span is presentation framing. These are not the canonical Rust/Clean INK hero.'};
source.frames.push(...exported.frames);source.asset.recipe=`${exported.recipe} + diagnostic-v1`;
for(const [clip,data]of Object.entries(exported.clips))source.asset.clips[clip]!.d45=data as typeof source.asset.clips[string]['d45'];
source.asset.clips.idle!.d45={...source.asset.clips.idle!.d45!,frames:[exported.clips.walk.frames[0]],durationsMs:[800],notifies:[]};
for(const [id,dirs]of Object.entries({...source.asset.clips}))if(source.asset.clips['enemy_'+id])source.asset.clips['enemy_'+id]=structuredClone(dirs);
for(const [id,total]of [['attack_sword_02',32],['attack_sword_03',44]] as const){const c=structuredClone(source.asset.clips.attack_sword_01!.d45!);c.durationsMs=c.durationsMs.map(ms=>ms*(total/36));c.notifies=c.notifies.map(n=>({...n,atMs:n.atMs*(total/36)}));source.asset.clips[id]!.d45=c;}
parseSource(source);await writeAsset('staging/source.json',JSON.stringify(source,null,2));
