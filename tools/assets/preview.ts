import type { AssetScope } from './bundles';
import { ensureBundlePack } from './bundles';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AssetCache } from './cache';
import { projectRoot } from './paths';
import { readLock, ensurePack, recipeHash } from './pack';
import { preparationSelection } from './recipe';
import { linkTree } from './incremental';
import { prepareSteps } from './preparation';
import { shaFile } from './sources';
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
      for (const [name, hash] of Object.entries(descriptor.files))
        if ((await shaFile(path.join(held.root, 'work', name))) !== hash)
          throw new Error('Prototype asset output changed');
      return { held: { ...held, root: path.join(held.root, 'work') }, lock: descriptor };
    } catch (error) {
      await held.release();
      throw error;
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
  const selectedIds = [
    ...new Set([...('selections' in base.lock ? base.lock.selections : []), ...ids]),
  ];
  const steps = preparationSelection(selectedIds);
  const startRecipe = await recipeHash();
  const priorSelections = 'selections' in base.lock ? base.lock.selections : [];
  if (
    'selections' in base.lock &&
    base.lock.recipeSha256 === startRecipe &&
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
      .update(JSON.stringify([baseSha256, startRecipe, selectedIds]))
      .digest('hex')
      .slice(0, 24);
  const held = await cache.lease(entry, 0, true);
  const work = path.join(held.root, 'next'),
    old = path.join(held.root, 'work');
  try {
    await fs.rm(work, { recursive: true, force: true });
    await fs.mkdir(work, { recursive: true });
    await linkTree(base.held.root, work);
    const { digests, files } = await prepareSteps({
      steps,
      workspace: work,
      cache: path.join(held.root, 'steps'),
      env,
    });
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
      } satisfies Preview),
    );
    const index = await cache.lease(previewName(projectRoot) + '-index');
    try {
      await fs.writeFile(path.join(index.root, 'preview.json'), JSON.stringify({ entry }));
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
  }
}
