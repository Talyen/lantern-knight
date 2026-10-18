import { onAsyncExit } from '../scope-exit';
import { readJson, writeJson } from '../json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safeRelative } from './files';
import { forEachFile } from './file-batches';

import { readLibrarySource } from './sources';
import { verifiedOutput, fileChecksums } from '../verified-files';

type SourceRead = {
  member: string;
  group: string;
  root: string;
  indexPath: string;
  sha256: string;
};
type Receipt = {
  version: 1;
  key: string;
  digest: string;
  files: Record<string, string>;
  sources: SourceRead[];
};
export async function linkTree(source: string, destination: string, merge = false) {
  const pending = [[source, destination]] as [string, string][];
  while (pending.length) {
    await forEachFile(pending.splice(0, 16), async ([fromRoot, toRoot]) => {
      await fs.mkdir(toRoot, { recursive: true });
      const entries = await fs.readdir(fromRoot, { withFileTypes: true });
      await forEachFile(entries, async (entry) => {
        if (entry.name.startsWith('.')) return;
        const from = path.join(fromRoot, entry.name),
          to = path.join(toRoot, entry.name);
        if (entry.isSymbolicLink())
          throw new Error('Immutable asset layers cannot contain symlinks');
        if (entry.isDirectory()) pending.push([from, to]);
        else
          await fs.link(from, to).catch((error: NodeJS.ErrnoException) => {
            if (!merge || error.code !== 'EEXIST') throw error;
          });
      });
    });
  }
}
// Delivery mutates producer manifests. Retain those small documents separately
// while native pages/media remain in the leased layer with no duplicate cache.
const storedOutput = (name: string, cachePublic?: boolean) =>
  cachePublic !== false || !name.startsWith('public/') || name.endsWith('.json');
export async function cachedPreparationStep(options: {
  file: string;
  workspace: string;
  cache: string;
  key: string;
  run: (env: NodeJS.ProcessEnv) => Promise<void>;
  validate?: () => Promise<void>;
  verifyOutputs?: (hashes: Readonly<Record<string, string>>) => Promise<void>;
  hashFiles?: (names: readonly string[]) => Promise<Record<string, string>>;
  sourceVerified?: (source: SourceRead) => boolean;
  cachePublic?: boolean;
  sourceLocation?: { root: string; indexPath: string; strict: boolean };
}) {
  const directory = path.join(options.cache, options.file.replace(/\.[^.]+$/, ''));
  let prior: Receipt | undefined;
  try {
    prior = (await readJson(path.join(directory, 'receipt.json'))) as Receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  if (prior?.version === 1 && prior.key === options.key) {
    try {
      const names = Object.keys(prior.files);
      const stored = names.filter((name) => storedOutput(name, options.cachePublic));
      if (options.cachePublic === false) {
        const publicNames = names.filter((name) => !storedOutput(name, options.cachePublic));
        const hashes = await (options.hashFiles?.(publicNames) ??
          fileChecksums(options.workspace, publicNames));
        for (const name of publicNames)
          if (hashes[name] !== prior.files[name])
            throw new Error('Cached preparation output differs');
      }
      await verifiedOutput(path.join(directory, 'files'), stored, async () => {
        const hashes = await fileChecksums(path.join(directory, 'files'), stored);
        for (const name of stored)
          if (hashes[name] !== prior!.files[name])
            throw new Error('Cached preparation output differs');
      });
      // Source bytes are verified by the normal resolver; unrelated source groups are never read.
      for (const source of prior.sources) {
        if (options.sourceVerified?.(source)) continue;
        const bytes = await readLibrarySource(source.member, source.group, {
          root: source.root,
          indexPath: source.indexPath,
          ...options.sourceLocation,
        });
        if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
          throw new Error('Cached preparation source changed');
      }
      await forEachFile(stored, async (name) => {
        safeRelative(name);
        const target = path.join(options.workspace, name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rm(target, { force: true });
        await fs.link(path.join(directory, 'files', name), target);
      });
      return {
        reused: true,
        digest: prior.digest,
        files: Object.keys(prior.files),
        hashes: prior.files,
      };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !/Cached preparation/.test(String(error))
      )
        throw error;
    }
  }
  const temporary = directory + '.' + randomUUID();
  await fs.mkdir(temporary, { recursive: true });
  const outputs = path.join(temporary, 'outputs.log'),
    sources = path.join(temporary, 'sources.log');
  await using _cleanup1 = onAsyncExit(() => fs.rm(temporary, { recursive: true, force: true }));
  await options.run({ LANTERN_STEP_OUTPUT_LOG: outputs, LANTERN_STEP_INPUT_LOG: sources });
  await options.validate?.();
  const readLog = (file: string) =>
    fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  const names = [...new Set((await readLog(outputs)).split('\n').filter(Boolean))];
  if (options.file.endsWith('.py'))
    names.push('staging/animation/flow.json', 'staging/animation/flow.png');
  if (!names.length) throw new Error('Preparation step recorded no owned output: ' + options.file);
  names.sort();
  const files = await (options.hashFiles?.(names) ?? fileChecksums(options.workspace, names));
  await options.verifyOutputs?.(files);
  await fs.mkdir(path.join(temporary, 'files'), { recursive: true });
  await forEachFile(
    names.filter((name) => storedOutput(name, options.cachePublic)),
    async (name) => {
      safeRelative(name);
      const target = path.join(temporary, 'files', name),
        original = path.join(options.workspace, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.link(original, target);
    },
  );
  const sourceReads = (await readLog(sources))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SourceRead);
  const unique = [
    ...new Map(sourceReads.map((source) => [JSON.stringify(source), source])).values(),
  ];
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  await writeJson(path.join(temporary, 'receipt.json'), {
    version: 1,
    key: options.key,
    digest,
    files,
    sources: unique,
  } satisfies Receipt);
  await fs.rm(outputs, { force: true });
  await fs.rm(sources, { force: true });
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rename(temporary, directory);
  return { reused: false, digest, files: names, hashes: files };
}

// Scoped preparation retains intermediate artwork needed by catalog-wide
// companions without invoking unrelated producers. Only receipt-verified files
// from the leased base are linked; missing staging requires a full preparation.
export async function restorePreparationStaging(cache: string, workspace: string) {
  for (const step of (await import('./recipe')).preparationSteps) {
    const directory = path.join(cache, step.file.replace(/\.[^.]+$/, ''));
    const receipt = (await readJson(path.join(directory, 'receipt.json'))) as Receipt;
    const names = Object.keys(receipt.files).filter((name) => name.startsWith('staging/'));
    await verifiedOutput(
      path.join(directory, 'files'),
      names,
      async () => {
        const hashes = await fileChecksums(path.join(directory, 'files'), names);
        for (const name of names)
          if (hashes[name] !== receipt.files[name])
            throw new Error('Cached preparation staging differs');
      },
      '.verified-staging.json',
    );
    await forEachFile(names, async (name) => {
      safeRelative(name);
      const target = path.join(workspace, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs
        .link(path.join(directory, 'files', name), target)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
    });
  }
}
