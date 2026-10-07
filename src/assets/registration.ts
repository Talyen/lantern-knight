import {z} from 'zod';
const finite=z.number().finite(),size=z.number().int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const rect=z.tuple([finite.nonnegative(),finite.nonnegative(),size,size]);
const point=z.tuple([finite,finite]),canvas=z.tuple([size,size]);
const sword=z.object({a:z.tuple([finite,finite,finite,finite]),b:z.tuple([finite,finite,finite,finite]),width:finite.positive()});
const pair=z.object({asset:z.string(),clip:z.string(),heading:z.string(),from:z.string(),to:z.string(),canvas,anchor:point,density:finite.positive(),supported:z.boolean(),silhouetteAgreement:finite.min(0).max(1),colorError:finite.nonnegative(),rejectionReason:z.enum(['uncertain-sword','pose-disagreement']).nullable(),offsetA:point,offsetB:point,rect,rawRect:rect,guardedRect:rect,rawGuardedRect:rect,sword:sword.optional()});
const animation=z.object({width:size,height:size,canvas,bytes:size,sha256:hash,tuningHash:hash,stagedSourceHash:hash,preparedHashes:z.record(z.string(),hash),pairs:z.array(pair),offsets:z.record(z.string(),point),clips:z.record(z.string(),z.object({asset:z.string(),frames:z.array(z.string()).min(1),weightedHoldsMs:z.array(finite.positive()),loop:z.boolean(),registration:z.object({canvas,anchor:point,density:finite.positive()})}))}).passthrough();
const mask=z.object({width:size,height:size,alpha:z.array(z.number().int().min(0).max(255))});
export const RegistrationSchema=z.object({schemaVersion:z.literal(2),animation,coverage:z.object({masks:z.record(z.string(),mask),sockets:z.record(z.string(),z.array(z.array(finite)))}).passthrough()}).strict();
export type PreparedRegistration=z.infer<typeof RegistrationSchema>;
export function parseRegistration(value:unknown){const data=RegistrationSchema.parse(value);
 for(const m of Object.values(data.coverage.masks))if(m.alpha.length!==m.width*m.height)throw new Error('Coverage mask dimensions differ');
 if(data.animation.width>4096||data.animation.height>4096)throw new Error('Animation field exceeds portable texture limit');
 const frames=new Set(Object.values(data.animation.clips).flatMap(c=>c.frames));
 const seen=new Set<string>();
 for(const p of data.animation.pairs){
  if(!frames.has(p.from)||!frames.has(p.to))throw new Error('Unknown animation frame binding');
  const key=[p.asset,p.clip,p.heading,p.from,p.to].join(':');if(seen.has(key))throw new Error('Duplicate animation transition');seen.add(key);
  if(p.supported&&(p.silhouetteAgreement<.96||p.colorError>.09||p.rejectionReason!==null))throw new Error('Incoherent animation transition');
  if(p.supported&&!p.sword)throw new Error('Guarded transition requires sword registration');
  for(const r of [p.rect,p.rawRect,p.guardedRect,p.rawGuardedRect])if(r[0]+r[2]>data.animation.width||r[1]+r[3]>data.animation.height)throw new Error('Animation field crop escapes texture');
  if(p.sword)for(const line of [p.sword.a,p.sword.b])if(Math.hypot(line[2]-line[0],line[3]-line[1])<1)throw new Error('Degenerate sword registration');
 }
 for(const c of Object.values(data.animation.clips))if(c.frames.length!==c.weightedHoldsMs.length)throw new Error('Animation holds differ from frame count');
 return data;
}
