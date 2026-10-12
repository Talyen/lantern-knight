import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AssetCache, diskBytes } from './cache';
import { recipeHash, validateCachedPack, lockFile, LockSchema, type AssetLock } from './pack';
import { shaFile } from './sources';
import { gh } from './github';
import type { PreparedAssets } from './prepare';

export async function verifyRemote(
  lock: AssetLock,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
) {
  const held = await cache.lease('publication-' + lock.sha256);
  const receiptFile = path.join(held.root, 'verified.json');
  let etag: string | undefined;
  try {
    try {
      const prior = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
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
      const temporary = receiptFile + '.' + randomUUID();
      try {
        await fs.writeFile(
          temporary,
          JSON.stringify({ sha256: lock.sha256, bytes: lock.bytes, etag: validator }),
        );
        await fs.rename(temporary, receiptFile);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    } else await fs.rm(receiptFile, { force: true });
  } finally {
    await held.release();
  }
}
async function validateCandidate(prepared: PreparedAssets) {
  if (prepared.lock.recipeSha256 !== (await recipeHash()))
    throw new Error('Asset recipes changed; prepare and validate again');
  await validateCachedPack(prepared.payload, prepared.lock);
}
async function uploadArchive(
  lock: import('./pack').AssetLock,
  archive: string,
  publish: typeof gh,
) {
  let existing: { assets: { name: string }[] } | undefined;
  try {
    const value = JSON.parse(
      await publish(['release', 'view', lock.releaseTag, '--json', 'assets']),
    );
    if (
      !Array.isArray(value.assets) ||
      value.assets.some((a: unknown) => !a || typeof (a as { name?: unknown }).name !== 'string')
    )
      throw new Error('Invalid existing release metadata');
    existing = value;
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const detail =
      String(error) +
      ' ' +
      (typeof stderr === 'string' || Buffer.isBuffer(stderr) ? stderr.toString() : '');
    if (!/release not found|HTTP 404|Not Found/i.test(detail)) throw error;
  }
  if (existing) {
    if (!existing.assets.some((a) => a.name === lock.filename))
      await publish(['release', 'upload', lock.releaseTag, archive + '#' + lock.filename]);
  } else {
    const commit = (
      await publish([
        'api',
        'repos/Talyen/lantern-knight/git/ref/heads/main',
        '--jq',
        '.object.sha',
      ])
    ).trim();
    await publish([
      'release',
      'create',
      lock.releaseTag,
      archive + '#' + lock.filename,
      '--target',
      commit,
      '--title',
      'Prepared assets ' + lock.sha256.slice(0, 16),
      '--notes',
      'Verified runtime asset pack. Recipe SHA-256: ' + lock.recipeSha256,
      '--latest=false',
    ]);
  }
}
export async function publishBundledPrepared(
  prepared: PreparedAssets,
  publish = gh,
  verify = verifyRemote,
  target = lockFile,
  beforePin: () => Promise<void> = async () => {},
) {
  await validateCandidate(prepared);
  if (prepared.archive) {
    if (
      (await fs.stat(prepared.archive)).size !== prepared.lock.bytes ||
      (await shaFile(prepared.archive)) !== prepared.lock.sha256
    )
      throw new Error('Prepared archive differs from the reviewed candidate');
    await fs.rm(prepared.archive);
    await prepared.held.reserve(await diskBytes(prepared.held.root));
  }
  let previous: import('./pack').AssetLock | undefined;
  try {
    previous = LockSchema.parse(JSON.parse(await fs.readFile(target, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const { prepareBundles } = await import('./bundles');
  const plan = await prepareBundles(prepared, previous);
  for (const [name, lock] of Object.entries(plan.pin.bundles)) {
    if (plan.archives[name]) await uploadArchive(lock, plan.archives[name]!, publish);
    await verify(lock);
  }
  await validateCandidate(prepared);
  await beforePin();
  const temporary = target + '.' + randomUUID();
  try {
    await fs.writeFile(temporary, JSON.stringify(plan.pin, null, 2) + '\n');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  console.log('Published and pinned immutable bundles; unchanged bundles were reused.');
}
