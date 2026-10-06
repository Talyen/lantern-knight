import { z } from 'zod';
import { contract, HEADINGS } from '../core/camera';
const finite = z.number().finite();
const positive = finite.positive();
const int = z.number().int().nonnegative();
const pair = z.tuple([finite,finite]);
const rect = z.tuple([int,int,z.number().int().positive(),z.number().int().positive()]);
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const path = z.string().regex(/^[a-zA-Z0-9_/-]+\.(png|json)$/).refine(v=>!v.split('/').includes('..')&&!v.startsWith('/'),'relative approved-root path required');
const notify = z.object({id,atMs:finite.nonnegative(),kind:z.enum(['footstep','whoosh','flash','dust'])}).strict();
const timing = z.object({frames:z.array(id).min(1),durationsMs:z.array(positive).min(1),loop:z.boolean(),notifies:z.array(notify)}).strict();
const metadata = z.object({
  id,type:z.literal('character'),schemaVersion:z.literal(1),contentVersion:z.string().min(1),
  bundle:z.enum(['hero','room']),status:z.enum(['diagnostic','proxy','production']),
  provenance:z.object({creator:z.string().min(1),license:z.string().min(1),source:z.string().min(1)}).strict(),
  contractId:z.literal(contract.id),bakeVersion:z.literal(contract.bakeVersion),
  canvas:z.tuple([z.number().int().positive(),z.number().int().positive()]),density:positive,anchor:pair,padding:int,
  colorSpace:z.literal('srgb'),alpha:z.literal('straight'),recipe:z.string().min(1),
  renderCategory:z.literal('cutout'),shadow:z.object({radius:positive,opacity:finite.min(0).max(1)}).strict(),
  collisionFootprint:z.literal('hero-circle-v1'),occlusion:z.literal('foot-depth-camera-plane'),
  fallbacks:z.record(z.string(),z.string()),dependencies:z.array(id),requiredClips:z.array(id),
  clips:z.record(z.string(),z.record(z.enum(HEADINGS),timing)),
}).strict();
const sourceFrame=z.object({id,path,origin:z.enum(['diagnostic','blender-proxy','production']),attachments:z.record(z.string(),pair)}).strict();
export const SourceSchema=z.object({schemaVersion:z.literal(1),asset:metadata,frames:z.array(sourceFrame).min(1)}).strict();
const runtimeFrame=sourceFrame.omit({path:true}).extend({source:path,page:id,rect,trim:rect,rotated:z.literal(false)}).strict();
const page=z.object({id,path,hash:z.string().length(64),width:z.number().int().positive(),height:z.number().int().positive(),bytes:int,rgbaBytes:int,extrusion:int,gutter:int,mipmaps:z.literal(false)}).strict();
export const ManifestSchema=z.object({schemaVersion:z.literal(1),contractId:z.literal(contract.id),bakeVersion:z.literal(contract.bakeVersion),hash:z.string().length(64),toolVersion:z.string(),asset:metadata,frames:z.array(runtimeFrame),pages:z.array(page),bundles:z.record(z.string(),z.object({required:z.array(id),optional:z.array(id),dependencies:z.array(z.string())}).strict())}).strict();
export type Source=z.infer<typeof SourceSchema>;
export type Manifest=z.infer<typeof ManifestSchema>;
export type Frame=Manifest['frames'][number];
export type Clip=z.infer<typeof timing>;
export function validateSemantics(value: Source|Manifest, production=false) {
  const a=value.asset, ids=new Set<string>(), paths=new Set<string>();
  const fail=(field:string,message:string):never=>{throw new Error(`${a.id}.${field}: ${message}`);};
  for(const f of value.frames) {
    if(ids.has(f.id)) fail(`frames.${f.id}`,'duplicate ID'); ids.add(f.id);
    const p='path' in f?f.path:f.source;
    if(paths.has(p.toLowerCase())) fail(`frames.${f.id}.path`,'duplicate or case-colliding source path'); paths.add(p.toLowerCase());
    for(const [name,point] of Object.entries(f.attachments)) if(point.some((v,i)=>v<0||v>a.canvas[i]!)) fail(`frames.${f.id}.attachments.${name}`,'outside original canvas');
    if('trim' in f) {
      if(f.trim[0]+f.trim[2]>a.canvas[0]||f.trim[1]+f.trim[3]>a.canvas[1]) fail(`frames.${f.id}.trim`,'outside source canvas');
      const m=value as Manifest,p=m.pages.find(p=>p.id===f.page);
      if(!p||f.rect[0]+f.rect[2]>p.width||f.rect[1]+f.rect[3]>p.height||f.rect[2]!==f.trim[2]||f.rect[3]!==f.trim[3]) fail(`frames.${f.id}.rect`,'missing page or invalid atlas bounds');
    }
  }
  if(a.anchor.some((v,i)=>v<0||v>a.canvas[i]!)) fail('anchor','outside untrimmed canvas');
  for(const required of a.requiredClips) if(!a.clips[required]) fail('requiredClips',`missing ${required}`);
  for(const [clip,dirs] of Object.entries(a.clips)) for(const dir of HEADINGS) {
    const c=dirs[dir]; if(!c) fail(`clips.${clip}.${dir}`,'missing required heading; mirroring forbidden');
    if(c.frames.length!==c.durationsMs.length) fail(`clips.${clip}.${dir}`,'duration count differs from frame count');
    for(const f of c.frames) if(!ids.has(f)) fail(`clips.${clip}.${dir}`,`missing frame ${f}`);
    const end=c.durationsMs.reduce((x,y)=>x+y,0), seen=new Set<string>();
    for(const n of c.notifies) {if(n.atMs>=end||seen.has(n.id)) fail(`clips.${clip}.${dir}.notifies`,'event outside clip or duplicate ID'); seen.add(n.id);}
  }
  for(const [key,to] of Object.entries(a.fallbacks)) if(!a.clips[to]||a.clips[key]) fail('fallbacks','fallback target missing or overrides supported clip');
  if('pages' in value) { const seen=new Set<string>(); for(const p of value.pages) {if(seen.has(p.id)||p.width>contract.atlasMaxSize||p.height>contract.atlasMaxSize||p.rgbaBytes!==p.width*p.height*4) fail('pages','duplicate, oversized or invalid byte estimate');seen.add(p.id);} for(const b of Object.values(value.bundles)) for(const p of b.required) if(!seen.has(p)) fail('bundles',`missing required resource ${p}`); }
  if(production && (a.status!=='production'||contract.approval!=='approved'||value.frames.some(f=>f.origin!=='production'))) fail('status','production requires approved camera/design and production frames; proxy is development-only');
}
export function parseSource(data:unknown,production=false) {const s=SourceSchema.parse(data);validateSemantics(s,production);return s;}
export function parseManifest(data:unknown,production=false) {const m=ManifestSchema.parse(data);validateSemantics(m,production);return m;}
