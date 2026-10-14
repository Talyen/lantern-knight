import os from 'node:os';
import { audioTools, verifyAudioSources } from './audio';
import { readJson, writeJson } from '../json-file';
import { discoverLibrary, sourceSnapshot } from './discovery';
import { cameraCalibration } from '../../src/assets/camera-calibration';
import { stagePayload } from './payload';
import { listFiles } from './files';
import { verifiedOutput, fileChecksums } from '../verified-files';
import type { AssetScope } from './bundles';
import { ensureBundlePack } from './bundles';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AssetCache } from './cache';
import { projectRoot, sourceLibrary } from './paths';
import { readLock, ensurePack, recipeHash, validateCachedPack } from './pack';
import {
  preparationSelection,
  preparationStepKey,
  recipeInputs,
  mergePreparationSelections,
  preparationLayerKey,
} from './recipe';
import { linkTree, restorePreparationStaging } from './incremental';
import { prepareSteps, growthReservation } from './preparation';
import { readLibrarySource } from './sources';

const previewName = (root: string) =>
  'preview-' + createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 20);
type Preview = {
  version: 1;
  sha256: string;
  baseSha256: string;
  recipeSha256: string;
  selections: string[];
  files: Record<string, string>;
  librarySha256?: string;
  gpu?: boolean;
  complete?: boolean;
  full?: boolean;
};
export async function prototypeAssets(
  cache = new AssetCache(),
  root = projectRoot,
  scope: AssetScope = 'authoring',
  reusePrepared = false,
  fallback?: (
    lock: import('./pack').AssetLock,
  ) => Promise<import('./workspace').AssetWorkspace | undefined>,
) {
  const index = await cache.lease(previewName(root) + '-index');
  let entry: string | undefined;
  try {
    entry = (await readJson(path.join(index.root, 'preview.json'))).entry;
    if (typeof entry !== 'string' || !/^preview-[a-f0-9]{20}-[a-f0-9]{24}$/.test(entry))
      throw new Error('Invalid prototype layer identity');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    await index.release();
  }
  if (!entry && reusePrepared) {
    const shared = await cache.lease('preparation-base');
    try {
      const pointer = await readJson(path.join(shared.root, 'preview.json'));
      const pin = await readLock((name) => fs.readFile(path.join(root, name)));
      if (
        typeof pointer.entry !== 'string' ||
        !/^preview-[a-f0-9]{20}-[a-f0-9]{24}$/.test(pointer.entry)
      )
        throw new Error('Invalid shared preparation identity');
      if (pointer.baseSha256 === pin.sha256) entry = pointer.entry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    } finally {
      await shared.release();
    }
  }
  if (entry) {
    const held = await cache.lease(entry);
    try {
      const descriptor = (await readJson(path.join(held.root, 'preview.json'))) as Preview;
      if (descriptor.version !== 1 || !descriptor.sha256 || !descriptor.files)
        throw new Error('Invalid prototype asset layer');
      await verifiedOutput(
        path.join(held.root, 'work'),
        Object.keys(descriptor.files),
        async () => {
          const hashes = await fileChecksums(
            path.join(held.root, 'work'),
            Object.keys(descriptor.files),
          );
          for (const [name, hash] of Object.entries(descriptor.files))
            if (hashes[name] !== hash) throw new Error('Prototype asset output changed');
        },
        '.verified-prototype.json',
      );
      return {
        held: { ...held, root: path.join(held.root, 'work') },
        lock: descriptor,
        stepCache: path.join(held.root, 'steps'),
        files: descriptor.files,
      };
    } catch (error) {
      await held.release();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const lock = await readLock((name) => fs.readFile(path.join(root, name)));
  if (reusePrepared) {
    const held = await cache.lease('preparation');
    const payload = path.join(held.root, 'work/payload');
    try {
      const inventory = await validateCachedPack(payload, lock);
      return {
        held: { ...held, root: payload },
        lock,
        stepCache: path.join(held.root, 'steps'),
        files: Object.fromEntries(
          Object.entries(inventory.files).map(([name, file]) => [name, file.sha256]),
        ),
      };
    } catch (error) {
      await held.release();
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !/Prepared|Accepted/.test(String(error))
      )
        throw error;
    }
  }
  const demand = await fallback?.(lock);
  if (demand)
    return {
      held: {
        root: demand.root,
        release: demand.release,
        ensurePublicFile: demand.ensurePublicFile,
      },
      lock,
      stepCache: undefined,
      files: undefined,
    };
  return {
    held: await (lock.schemaVersion === 3
      ? ensureBundlePack(lock, cache, fetch, scope)
      : ensurePack(lock, cache)),
    lock,
    stepCache: undefined,
    files: undefined,
  };
}
export async function preparePreviewAssets(
  ids: string[],
  cache = new AssetCache(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const started = performance.now();
  const audioOnly = ids.length > 0 && ids.every((id) => id === 'audio' || id.startsWith('audio-'));
  // Audio has no image producers to refresh an unrelated shared staging layer.
  // Preserve this checkout's explicit local layer, otherwise start at its pin.
  const base = await prototypeAssets(cache, projectRoot, 'authoring', !audioOnly);
  let indexGuard: Awaited<ReturnType<AssetCache['lease']>> | undefined;
  let checkpointLease: Awaited<ReturnType<AssetCache['lease']>> | undefined;
  try {
    indexGuard = await cache.lease(previewName(projectRoot) + '-index');
    const completeBase = 'complete' in base.lock && base.lock.complete === true;
    let steps = preparationSelection(ids.length && (completeBase || audioOnly) ? ids : []);
    const startRecipe = await recipeHash();
    const audioStep = steps.find((operation) => operation.file.endsWith('prepare-audio.ts'));
    let audioFingerprint: string | undefined,
      audioFresh = true;
    if (audioStep) {
      audioFingerprint = (await audioTools(env)).fingerprint;
      await verifyAudioSources(
        env.ASSET_LIBRARY_ROOT ?? path.join(os.homedir(), 'Documents/Asset Library'),
        env,
      );
      audioFresh = false;
      if (base.stepCache) {
        try {
          const receipt = JSON.parse(
            await fs.readFile(
              path.join(base.stepCache, audioStep.file.replace(/\.[^.]+$/, ''), 'receipt.json'),
              'utf8',
            ),
          );
          audioFresh =
            receipt.key ===
            preparationStepKey(audioStep, await recipeInputs(), new Map(), audioFingerprint);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    const selectedIds = mergePreparationSelections(
      base.lock,
      ids,
      startRecipe,
      env.LANTERN_LIBRARY_SHA256,
    );
    const priorSelections = 'selections' in base.lock ? base.lock.selections : [];
    if (
      audioFresh &&
      'selections' in base.lock &&
      (ids.length > 0 || (completeBase && base.lock.full === true)) &&
      base.lock.recipeSha256 === startRecipe &&
      base.lock.librarySha256 === env.LANTERN_LIBRARY_SHA256 &&
      (audioOnly || env.LANTERN_IMAGE_GPU !== '1' || base.lock.gpu === true) &&
      (base.lock.full === true || ids.every((id) => priorSelections.includes(id)))
    ) {
      try {
        const directory = path.dirname(base.held.root);
        const sourceVerified = await sourceSnapshot(env);
        for (const operation of steps) {
          const receipt = (await readJson(
            path.join(directory, 'steps', operation.file.replace(/\.[^.]+$/, ''), 'receipt.json'),
          )) as {
            sources: {
              member: string;
              group: string;
              root: string;
              indexPath: string;
              sha256: string;
            }[];
          };
          for (const source of receipt.sources) {
            if (sourceVerified?.(source)) continue;
            const bytes = await readLibrarySource(source.member, source.group, {
              root: source.root,
              indexPath: source.indexPath,
              ...(env.LANTERN_LIBRARY_INDEX
                ? { root: sourceLibrary(env), indexPath: env.LANTERN_LIBRARY_INDEX, strict: true }
                : {}),
            });
            if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
              throw new Error('Prototype source changed');
          }
        }
        if (
          env.LANTERN_LIBRARY_SHA256 &&
          (await discoverLibrary(cache, env)).LANTERN_LIBRARY_SHA256 !== env.LANTERN_LIBRARY_SHA256
        )
          throw new Error(
            'External library changed during refresh; retry with the current inventory',
          );
        // Reuse can come from another checkout's immutable preparation. Select
        // it locally as well, so the next preview does not fall back to the pin.
        await writeJson(path.join(indexGuard.root, 'preview.json.tmp'), {
          entry: path.basename(directory),
        });
        await fs.rename(
          path.join(indexGuard.root, 'preview.json.tmp'),
          path.join(indexGuard.root, 'preview.json'),
        );
        console.log('Prototype assets reused: selected source bytes and immutable outputs match.');
        return { sha256: base.lock.sha256, steps: steps.map((step) => step.file) };
      } finally {
        await base.held.release();
      }
    }
    const baseSha256 = 'baseSha256' in base.lock ? base.lock.baseSha256 : base.lock.sha256;
    const entry =
      previewName(projectRoot) +
      '-' +
      preparationLayerKey({
        baseSha256,
        recipeSha256: audioFingerprint
          ? createHash('sha256')
              .update(startRecipe + audioFingerprint)
              .digest('hex')
          : startRecipe,
        selections: selectedIds,
        librarySha256: env.LANTERN_LIBRARY_SHA256,
        gpu: env.LANTERN_IMAGE_GPU === '1',
        steps,
      });
    const indexLease = await cache.lease(previewName(projectRoot) + '-index');
    let checkpoint: { entry: string; baseSha256: string; librarySha256?: string } | undefined;
    try {
      checkpoint = await readJson(path.join(indexLease.root, 'checkpoint.json'));
      if (
        !checkpoint ||
        !new RegExp('^' + previewName(projectRoot) + '-[a-f0-9]{24}$').test(checkpoint.entry)
      )
        throw new Error('Invalid preparation checkpoint');
      // Changed sources invalidate their producer keys; immutable derivatives
      // can still be reused by content identity when the library is reorganized.
      if (checkpoint.baseSha256 !== baseSha256) checkpoint = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    } finally {
      await indexLease.release();
    }
    if (audioOnly) checkpoint = undefined;
    checkpointLease =
      checkpoint && checkpoint.entry !== entry ? await cache.lease(checkpoint.entry) : undefined;
    const held = await cache.lease(entry, 0, true);
    const work = path.join(held.root, 'next'),
      old = path.join(held.root, 'work');
    let resumed = false;
    try {
      const priorWork = checkpoint
        ? path.join(checkpointLease?.root ?? held.root, 'next')
        : undefined;
      resumed =
        !!priorWork &&
        (await fs.access(priorWork).then(
          () => true,
          () => false,
        ));
      if (!resumed || priorWork !== work) {
        await fs.rm(work, { recursive: true, force: true });
        await fs.mkdir(work, { recursive: true });
        await linkTree(resumed ? priorWork! : base.held.root, work);
      }
      if (resumed)
        console.log(
          'Resuming external preparation checkpoint; producers and source identities will be revalidated.',
        );
      const stepRoots = [
        ...(checkpointLease ? [path.join(checkpointLease.root, 'steps')] : []),
        base.stepCache ?? path.join(path.dirname(base.held.root), 'steps'),
      ];
      const inputs = await recipeInputs();
      for (const oldSteps of stepRoots) {
        const digests = new Map<string, string>();
        for (const operation of preparationSelection([])) {
          const name = operation.file.replace(/\.[^.]+$/, ''),
            from = path.join(oldSteps, name);
          if (
            await fs.access(from).then(
              () => true,
              () => false,
            )
          ) {
            const receiptBytes = await fs.readFile(path.join(from, 'receipt.json'));
            const receipt = JSON.parse(receiptBytes.toString());
            const key = preparationStepKey(
              operation,
              inputs,
              digests,
              operation.file.endsWith('prepare-audio.ts')
                ? audioFingerprint
                : operation.file.endsWith('prepare-library.ts')
                  ? env.LANTERN_LIBRARY_SHA256
                  : operation.file.endsWith('prepare-image-delivery.ts')
                    ? (env.LANTERN_IMAGE_GPU ?? '0')
                    : undefined,
            );
            digests.set(operation.file, receipt.digest);
            if (key !== receipt.key && steps.length === preparationSelection([]).length) continue;
            const to = path.join(held.root, 'steps', name);
            if (
              await fs.access(path.join(to, 'receipt.json')).then(
                () => true,
                () => false,
              )
            )
              continue;
            await fs.mkdir(to, { recursive: true });
            if (
              [
                'prepare-library.ts',
                'prepare-lighting.ts',
                'prepare-graveyard-coverage.ts',
                'prepare-image-delivery.ts',
              ].some((file) => operation.file.endsWith(file))
            ) {
              await fs.writeFile(path.join(to, 'receipt.json'), receiptBytes);
              await fs.mkdir(path.join(to, 'files'), { recursive: true });
              for (const folder of ['staging', 'public']) {
                const source = path.join(from, 'files', folder);
                if (
                  await fs.access(source).then(
                    () => true,
                    () => false,
                  )
                )
                  await linkTree(source, path.join(to, 'files', folder));
              }
            } else await linkTree(from, to, true);
          }
        }
      }
      if (!audioOnly && steps.length < preparationSelection([]).length) {
        try {
          await restorePreparationStaging(path.join(held.root, 'steps'), work);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
            !(error instanceof SyntaxError) &&
            !/Cached preparation staging/.test(String(error))
          )
            throw error;
          console.log('Complete staging is unavailable; preparing the full dependency graph.');
          steps = preparationSelection([]);
        }
      }
      const checkpointIndex = await cache.lease(previewName(projectRoot) + '-index');
      try {
        const target = path.join(checkpointIndex.root, 'checkpoint.json');
        await writeJson(target + '.tmp', {
          entry,
          baseSha256,
          librarySha256: env.LANTERN_LIBRARY_SHA256,
        });
        await fs.rename(target + '.tmp', target);
      } finally {
        await checkpointIndex.release();
      }
      await checkpointLease?.release();
      checkpointLease = undefined;
      let knownContent = base.files;
      if (resumed && knownContent) {
        const unchanged: Record<string, string> = {};
        const names = Object.keys(knownContent);
        for (let offset = 0; offset < names.length; offset += 64)
          await Promise.all(
            names.slice(offset, offset + 64).map(async (name) => {
              const [prior, current] = await Promise.all(
                [base.held.root, work].map((root) =>
                  fs.lstat(path.join(root, name)).catch((error: NodeJS.ErrnoException) => {
                    if (error.code === 'ENOENT') return undefined;
                    throw error;
                  }),
                ),
              );
              // Checkpoint writers replace files atomically. Retain the verified
              // base proof only for the same unchanged file; linking changes ctime.
              if (
                prior?.isFile() &&
                current?.isFile() &&
                prior.ino !== 0 &&
                prior.dev === current.dev &&
                prior.ino === current.ino &&
                prior.size === current.size &&
                prior.mtimeMs === current.mtimeMs &&
                prior.mode === current.mode
              )
                unchanged[name] = knownContent![name]!;
            }),
          );
        knownContent = unchanged;
      }
      const { digests, checksums } = await prepareSteps({
        steps,
        workspace: work,
        cache: path.join(held.root, 'steps'),
        env,
        knownContent,
        reserveGrowth: await growthReservation(held),
      });
      const calibrationFile = path.join(work, 'public/generated/calibration.json');
      await writeJson(calibrationFile + '.tmp', cameraCalibration());
      await fs.rename(calibrationFile + '.tmp', calibrationFile);
      if (audioOnly) {
        await fs.mkdir(path.join(work, 'metadata/audio'), { recursive: true });
        await fs.copyFile(
          path.join(work, 'staging/audio/receipt.json'),
          path.join(work, 'metadata/audio/receipt.json'),
        );
      } else await stagePayload(path.join(work, 'public'), path.join(work, 'staging'), work, true);
      await fs.rm(path.join(work, 'staging'), { recursive: true, force: true });
      const files = await checksums(
        (await listFiles(work)).filter((name) => /^(public|metadata)\//.test(name)),
      );
      if (
        env.LANTERN_LIBRARY_SHA256 &&
        (await discoverLibrary(cache, env)).LANTERN_LIBRARY_SHA256 !== env.LANTERN_LIBRARY_SHA256
      )
        throw new Error(
          'External library changed during preparation; retry with the current source inventory',
        );
      if ((await recipeHash()) !== startRecipe)
        throw new Error('Preparation inputs changed during scoped import');
      const digest = createHash('sha256')
        .update(JSON.stringify([base.lock.sha256, digests.size ? [...digests] : [], files]))
        .digest('hex');
      await fs.rm(old, { recursive: true, force: true });
      await fs.rename(work, old);
      await writeJson(path.join(held.root, 'preview.json'), {
        version: 1,
        sha256: digest,
        baseSha256,
        recipeSha256: startRecipe,
        selections: selectedIds,
        files,
        librarySha256: env.LANTERN_LIBRARY_SHA256,
        gpu: audioOnly
          ? 'gpu' in base.lock && base.lock.gpu === true
          : env.LANTERN_IMAGE_GPU === '1',
        complete: completeBase || steps.length === preparationSelection([]).length,
        full: steps.length === preparationSelection([]).length,
      } satisfies Preview);
      // The complete new layer owns its linked files. Releasing this operation's
      // base lease lets the cache evict an unused predecessor before publishing
      // the index; other readers retain their own independent leases.
      await base.held.release();
      await held.reserve(await (await import('./cache')).diskBytes(held.root));
      const index = await cache.lease(previewName(projectRoot) + '-index');
      try {
        await writeJson(path.join(index.root, 'preview.json.tmp'), { entry });
        await fs.rename(
          path.join(index.root, 'preview.json.tmp'),
          path.join(index.root, 'preview.json'),
        );
        await fs.rm(path.join(index.root, 'checkpoint.json'), { force: true });
      } finally {
        await index.release();
      }
      if (steps.length === preparationSelection([]).length) {
        const shared = await cache.lease('preparation-base');
        const temporary = path.join(shared.root, 'preview-' + randomUUID() + '.tmp');
        try {
          await writeJson(temporary, { entry, baseSha256 });
          await fs.rename(temporary, path.join(shared.root, 'preview.json'));
        } finally {
          await fs.rm(temporary, { force: true });
          await shared.release();
        }
      }
      await indexGuard.release();
      await cache.prunePreviews(previewName(projectRoot), entry);
      // Final checksums already validated this exclusively owned layer. Only
      // controlled renames/unlinks followed; retain its proof for the next refresh.
      await verifiedOutput(old, Object.keys(files), async () => {}, '.verified-prototype.json');
      console.log(
        `Prototype assets ready: ${steps.length} step(s) in ${((performance.now() - started) / 1000).toFixed(2)}s.`,
      );
      return { sha256: digest, steps: steps.map((step) => step.file) };
    } finally {
      await base.held.release();
      await held.release();
      await checkpointLease?.release();
    }
  } finally {
    await base.held.release();
    await checkpointLease?.release();
    await indexGuard?.release();
  }
}
