import {z} from 'zod';
const finite=z.number().finite(),size=z.number().int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const rect=z.tuple([finite.nonnegative(),finite.nonnegative(),size,size]);
const sword=z.object({a:z.tuple([finite,finite,finite,finite]),b:z.tuple([finite,finite,finite,finite]),width:finite.positive()});
const walk=z.object({width:size,height:size,canvas:z.tuple([size,size]),bytes:size,sha256:hash,tuningHash:hash,stagedSourceHash:hash,sourceHashes:z.record(z.string(),hash),preparedHashes:z.record(z.string(),hash),sourceRoot:z.string(),pairs:z.array(z.object({from:z.string(),to:z.string(),rect,rawRect:rect,guardedRect:rect,rawGuardedRect:rect,sword}).passthrough()).length(16)}).passthrough();
const mask=z.object({width:size,height:size,alpha:z.array(z.number().int().min(0).max(255))});
export const RegistrationSchema=z.object({schemaVersion:z.literal(1),walk,coverage:z.object({masks:z.record(z.string(),mask),sockets:z.record(z.string(),z.array(z.array(finite))) }).passthrough()}).strict();
export type PreparedRegistration=z.infer<typeof RegistrationSchema>;
export function parseRegistration(value:unknown){const data=RegistrationSchema.parse(value);
 for(const m of Object.values(data.coverage.masks))if(m.alpha.length!==m.width*m.height)throw new Error('Coverage mask dimensions differ');
 for(const p of data.walk.pairs)for(const r of [p.rect,p.rawRect,p.guardedRect,p.rawGuardedRect])if(r[0]+r[2]>data.walk.width||r[1]+r[3]>data.walk.height)throw new Error('Walk field crop escapes texture');
 return data;
}
