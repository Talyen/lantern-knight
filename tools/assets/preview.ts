import { discoverLibrary } from './discovery';
import { cameraCalibration } from '../../src/assets/camera-calibration';
import { stagePayload } from './payload';
import { listFiles } from './files';
import { verifiedOutput, fileChecksums } from '../verified-files';
import type { AssetScope } from './bundles';
import { ensureBundlePack } from './bundles';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AssetCache } from './cache';
import { projectRoot, sourceLibrary } from './paths';
import { readLock, ensurePack, recipeHash } from './pack';
import { preparationSelection } from './recipe';
import { linkTree } from './incremental';
import { prepareSteps } from './preparation';
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
};
export async function prototypeAssets(
  cache = new AssetCache(),
  root = projectRoot,
  scope: AssetScope = 'authoring',
) {
  const index = await cache.lease(previewName(root) + '-index');
  let entry: string | undefined;
  try {
    entry = JSON.parse(await fs.readFile(path.join(index.root, 'preview.json'), 'utf8')).entry;
    if (
      typeof entry !== 'string' ||
      !new RegExp('^' + previewName(root) + '-[a-f0-9]{24}$').test(entry)
    )
      throw new Error('Invalid prototype layer identity');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    await index.release();
  }
  if (entry) {
    const held = await cache.lease(entry);
    try {
      const descriptor = JSON.parse(
        await fs.readFile(path.join(held.root, 'preview.json'), 'utf8'),
      ) as Preview;
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
      return { held: { ...held, root: path.join(held.root, 'work') }, lock: descriptor };
    } catch (error) {
      await held.release();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const lock = await readLock((name) => fs.readFile(path.join(root, name)));
  return {
    held: await (lock.schemaVersion === 3
      ? ensureBundlePack(lock, cache, fetch, scope)
      : ensurePack(lock, cache)),
    lock,
  };
}
export async function preparePreviewAssets(
  ids: string[],
  cache = new AssetCache(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const base = await prototypeAssets(cache);
  let checkpointLease: Awaited<ReturnType<AssetCache['lease']>> | undefined;
  try {
    const selectedIds = [
      ...new Set([...('selections' in base.lock ? base.lock.selections : []), ...ids]),
    ];
    const steps = preparationSelection(ids.length ? selectedIds : []);
    const startRecipe = await recipeHash();
    const priorSelections = 'selections' in base.lock ? base.lock.selections : [];
    if (
      'selections' in base.lock &&
      base.lock.recipeSha256 === startRecipe &&
      base.lock.librarySha256 === env.LANTERN_LIBRARY_SHA256 &&
      (env.LANTERN_IMAGE_GPU !== '1' || base.lock.gpu === true) &&
      ids.every((id) => priorSelections.includes(id))
    ) {
      try {
        const directory = path.dirname(base.held.root);
        for (const operation of steps) {
          const receipt = JSON.parse(
            await fs.readFile(
              path.join(directory, 'steps', operation.file.replace(/\.[^.]+$/, ''), 'receipt.json'),
              'utf8',
            ),
          ) as {
            sources: {
              member: string;
              group: string;
              root: string;
              indexPath: string;
              sha256: string;
            }[];
          };
          for (const source of receipt.sources) {
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
      createHash('sha256')
        .update(
          JSON.stringify([
            baseSha256,
            startRecipe,
            selectedIds,
            env.LANTERN_LIBRARY_SHA256,
            env.LANTERN_IMAGE_GPU === '1',
          ]),
        )
        .digest('hex')
        .slice(0, 24);
    const indexLease = await cache.lease(previewName(projectRoot) + '-index');
    let checkpoint: { entry: string; baseSha256: string; librarySha256?: string } | undefined;
    try {
      checkpoint = JSON.parse(
        await fs.readFile(path.join(indexLease.root, 'checkpoint.json'), 'utf8'),
      );
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
        path.join(path.dirname(base.held.root), 'steps'),
      ];
      for (const oldSteps of stepRoots)
        for (const operation of preparationSelection([])) {
          const name = operation.file.replace(/\.[^.]+$/, ''),
            from = path.join(oldSteps, name);
          if (
            await fs.access(from).then(
              () => true,
              () => false,
            )
          ) {
            const to = path.join(held.root, 'steps', name);
            if (
              await fs.access(path.join(to, 'receipt.json')).then(
                () => true,
                () => false,
              )
            )
              continue;
            await fs.mkdir(to, { recursive: true });
            await linkTree(from, to, true);
          }
        }
      const checkpointIndex = await cache.lease(previewName(projectRoot) + '-index');
      try {
        const target = path.join(checkpointIndex.root, 'checkpoint.json');
        await fs.writeFile(
          target + '.tmp',
          JSON.stringify({ entry, baseSha256, librarySha256: env.LANTERN_LIBRARY_SHA256 }),
        );
        await fs.rename(target + '.tmp', target);
      } finally {
        await checkpointIndex.release();
      }
      await checkpointLease?.release();
      checkpointLease = undefined;
      const { digests } = await prepareSteps({
        steps,
        workspace: work,
        cache: path.join(held.root, 'steps'),
        env,
        knownContent: !resumed && 'files' in base.lock ? base.lock.files : undefined,
        afterStep: async ({ reused }) => {
          if (!reused) await held.reserve(await (await import('./cache')).diskBytes(held.root));
        },
      });
      const calibrationFile = path.join(work, 'public/generated/calibration.json');
      await fs.writeFile(calibrationFile + '.tmp', JSON.stringify(cameraCalibration()));
      await fs.rename(calibrationFile + '.tmp', calibrationFile);
      const payload = path.join(work, 'payload');
      await fs.rm(payload, { recursive: true, force: true });
      await stagePayload(path.join(work, 'public'), path.join(work, 'staging'), payload);
      for (const name of ['public', 'metadata']) {
        await fs.rm(path.join(work, name), { recursive: true, force: true });
        await fs.rename(path.join(payload, name), path.join(work, name));
      }
      await fs.rm(payload, { recursive: true, force: true });
      await fs.rm(path.join(work, 'staging'), { recursive: true, force: true });
      const files = await fileChecksums(
        work,
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
      await fs.writeFile(
        path.join(held.root, 'preview.json'),
        JSON.stringify({
          version: 1,
          sha256: digest,
          baseSha256,
          recipeSha256: startRecipe,
          selections: selectedIds,
          files,
          librarySha256: env.LANTERN_LIBRARY_SHA256,
          gpu: env.LANTERN_IMAGE_GPU === '1',
        } satisfies Preview),
      );
      // The complete new layer owns its linked files. Releasing this operation's
      // base lease lets the cache evict an unused predecessor before publishing
      // the index; other readers retain their own independent leases.
      await base.held.release();
      await held.reserve(await (await import('./cache')).diskBytes(held.root));
      const index = await cache.lease(previewName(projectRoot) + '-index');
      try {
        await fs.writeFile(path.join(index.root, 'preview.json'), JSON.stringify({ entry }));
        await fs.rm(path.join(index.root, 'checkpoint.json'), { force: true });
      } finally {
        await index.release();
      }
      console.log(
        `Prototype assets ready: ${steps.length} step(s); no unrelated baking, archive creation, packaging or publication.`,
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
  }
}
