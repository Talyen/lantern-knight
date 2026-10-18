import { onAsyncExit } from '../scope-exit';
import { readJson, writeJsonAtomic } from '../json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetCache } from './cache';
import {
  recipeHash,
  validateCachedPack,
  lockFile,
  LockSchema,
  type ArchivePin,
  preparationPin,
  recipeInputs,
  filePin,
} from './pack';
import { shaFile } from './sources';
import { gh } from './github';
import type { PreparedAssets } from './prepare';
import { publishFileDelivery } from './file-publication';
import { selectedFiles } from '../select-runtime-assets';

export async function verifyRemote(
  lock: ArchivePin,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
) {
  const held = await cache.lease('publication-' + lock.sha256);
  const receiptFile = path.join(held.root, 'verified.json');
  let etag: string | undefined;
  await using _cleanup1 = onAsyncExit(() => held.release());
  try {
    const prior = await readJson(receiptFile);
    if (
      prior.sha256 === lock.sha256 &&
      prior.bytes === lock.bytes &&
      typeof prior.etag === 'string' &&
      /^"[^"\r\n]{1,512}"$/.test(prior.etag)
    )
      etag = prior.etag;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  const url =
    'https://github.com/Talyen/lantern-knight/releases/download/' +
    lock.releaseTag +
    '/' +
    lock.filename;
  let response = await request(url, { headers: etag ? { 'If-None-Match': etag } : {} });
  // Strong validators identify the exact response bytes already fully hashed.
  if (etag && response.status === 304) {
    if (response.headers.get('etag') === etag) return;
    // If-None-Match uses weak comparison. A weak/missing response validator
    // cannot certify identical bytes, so obtain and hash the complete body.
    response = await request(url);
  }
  if (!response.ok || !response.body)
    throw new Error('Published pack unavailable: HTTP ' + response.status);
  const { createHash } = await import('node:crypto'),
    digest = createHash('sha256');
  let count = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    count += chunk.length;
    if (count > lock.bytes) throw new Error('Published pack exceeds pinned size');
    digest.update(chunk);
  }
  if (count !== lock.bytes || digest.digest('hex') !== lock.sha256)
    throw new Error('Published pack hash differs');
  const validator = response.headers.get('etag');
  if (validator && /^"[^"\r\n]{1,512}"$/.test(validator)) {
    await writeJsonAtomic(receiptFile, {
      sha256: lock.sha256,
      bytes: lock.bytes,
      etag: validator,
    });
  } else await fs.rm(receiptFile, { force: true });
}
async function validateCandidate(prepared: PreparedAssets) {
  if (prepared.lock.recipeSha256 !== (await recipeHash()))
    throw new Error('Asset recipes changed; prepare and validate again');
  await validateCachedPack(prepared.payload, prepared.lock);
}
export async function publishPrepared(
  prepared: PreparedAssets,
  options: {
    publish?: typeof gh;
    target?: string;
    beforePin?: () => Promise<void>;
    request?: typeof fetch;
    cache?: AssetCache;
  } = {},
) {
  const {
    publish = gh,
    target = lockFile,
    beforePin = async () => {},
    request = fetch,
    cache = new AssetCache(),
  } = options;
  await validateCandidate(prepared);
  // Selection validates current consumers; it never determines container membership.
  await selectedFiles(path.join(prepared.payload, 'public'), 'runtime');
  if (prepared.archive) {
    if (
      (await fs.stat(prepared.archive)).size !== prepared.lock.bytes ||
      (await shaFile(prepared.archive)) !== prepared.lock.sha256
    )
      throw new Error('Prepared archive differs from the reviewed candidate');
    await fs.rm(prepared.archive);
  }
  let previous: import('./pack').AssetLock | undefined;
  try {
    previous = LockSchema.parse(await readJson(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const inventory = await validateCachedPack(prepared.payload, prepared.lock);
  const accepted = preparationPin(prepared.lock, await recipeInputs(), inventory);
  if (accepted.schemaVersion === 1) throw new Error('Missing accepted preparation identity');
  const delivery = await publishFileDelivery(
    accepted,
    prepared.payload,
    cache,
    publish,
    request,
    previous?.schemaVersion === 3 || previous?.schemaVersion === 4 ? previous : undefined,
  );
  await validateCandidate(prepared);
  await beforePin();
  const current = await fs.readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (
    JSON.stringify(current ? LockSchema.parse(JSON.parse(current)) : undefined) !==
    JSON.stringify(previous)
  )
    throw new Error('Asset pin changed during publication; refusing to overwrite it');
  await writeJsonAtomic(target, filePin(accepted, delivery), true);
  console.log('Published verified file delivery; unchanged image containers were reused.');
}
