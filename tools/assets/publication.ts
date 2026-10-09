import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AssetCache } from './cache';
import {
  recipeHash,
  recipeInputs,
  validatePack,
  preparationPin,
  lockFile,
  LockSchema,
  type AssetLock,
} from './pack';
import { shaFile } from './sources';
import { gh } from './retention';
import type { prepareAssets } from './prepare';
export type PreparedAssets = Awaited<ReturnType<typeof prepareAssets>>;

async function verifyRemote(lock: AssetLock) {
  const held = await new AssetCache().lease('publication-' + randomUUID());
  try {
    const response = await fetch(
      'https://github.com/Talyen/lantern-knight/releases/download/' +
        lock.releaseTag +
        '/' +
        lock.filename,
    );
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
  } finally {
    await held.release();
    await fs.rm(held.root, { recursive: true, force: true });
  }
}
export async function validateCandidate(prepared: PreparedAssets) {
  if (prepared.lock.recipeSha256 !== (await recipeHash()))
    throw new Error('Asset recipes changed; prepare and validate again');
  await validatePack(prepared.payload, prepared.lock);
  if (
    (await fs.stat(prepared.archive)).size !== prepared.lock.bytes ||
    (await shaFile(prepared.archive)) !== prepared.lock.sha256
  )
    throw new Error('Prepared archive differs from the reviewed candidate');
}
export async function publishPrepared(
  prepared: PreparedAssets,
  publish = gh,
  verify = verifyRemote,
  target = lockFile,
  beforePin: () => Promise<void> = async () => {},
) {
  const lock = prepared.lock;
  const pin = await preparationPinFor(prepared);
  await validateCandidate(prepared);
  await uploadArchive(lock, prepared.archive, publish);
  await verify(lock);
  await validateCandidate(prepared);
  await beforePin();
  const temporary = target + '.' + randomUUID();
  try {
    await fs.writeFile(temporary, JSON.stringify(pin, null, 2) + '\n');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  console.log('Published and pinned ' + lock.releaseTag);
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
export async function bundlePinFor(prepared: PreparedAssets) {
  const plan = JSON.parse(
    await fs.readFile(path.join(prepared.held.root, 'bundles/plan.json'), 'utf8'),
  );
  const pin = LockSchema.parse(plan.pin);
  if (pin.sha256 !== prepared.lock.sha256) throw new Error('Bundle plan differs from candidate');
  return pin;
}
export async function preparationPinFor(prepared: PreparedAssets) {
  await validateCandidate(prepared);
  return preparationPin(
    prepared.lock,
    await recipeInputs(),
    await validatePack(prepared.payload, prepared.lock),
  );
}
