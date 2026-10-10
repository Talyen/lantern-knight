import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safeRelative } from './files';

import { shaFile, readLibrarySource } from './sources';
import { verifiedOutput } from '../verified-files';

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
export async function linkTree(source: string, destination: string) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = path.join(source, entry.name),
      to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Immutable asset layers cannot contain symlinks');
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await linkTree(from, to);
    } else {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.link(from, to);
    }
  }
}
export async function cachedPreparationStep(options: {
  file: string;
  workspace: string;
  cache: string;
  key: string;
  run: (env: NodeJS.ProcessEnv) => Promise<void>;
  validate?: () => Promise<void>;
}) {
  const directory = path.join(options.cache, options.file.replace(/\.[^.]+$/, ''));
  let prior: Receipt | undefined;
  try {
    prior = JSON.parse(await fs.readFile(path.join(directory, 'receipt.json'), 'utf8')) as Receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  if (prior?.version === 1 && prior.key === options.key) {
    try {
      await verifiedOutput(path.join(directory, 'files'), Object.keys(prior.files), async () => {
        for (const [name, hash] of Object.entries(prior!.files))
          if ((await shaFile(path.join(directory, 'files', safeRelative(name)))) !== hash)
            throw new Error('Cached preparation output differs');
      });
      // Source bytes are verified by the normal resolver; unrelated source groups are never read.
      for (const source of prior.sources) {
        const bytes = await readLibrarySource(source.member, source.group, {
          root: source.root,
          indexPath: source.indexPath,
        });
        if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
          throw new Error('Cached preparation source changed');
      }
      for (const name of Object.keys(prior.files)) {
        safeRelative(name);
        const target = path.join(options.workspace, name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rm(target, { force: true });
        await fs.link(path.join(directory, 'files', name), target);
      }
      return { reused: true, digest: prior.digest, files: Object.keys(prior.files) };
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
  try {
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
    if (!names.length)
      throw new Error('Preparation step recorded no owned output: ' + options.file);
    const files: Record<string, string> = {};
    for (const name of names.sort()) {
      safeRelative(name);
      const target = path.join(temporary, 'files', name),
        original = path.join(options.workspace, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.link(original, target);
      files[name] = await shaFile(original);
    }
    const sourceReads = (await readLog(sources))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SourceRead);
    const unique = [
      ...new Map(sourceReads.map((source) => [JSON.stringify(source), source])).values(),
    ];
    const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
    await fs.writeFile(
      path.join(temporary, 'receipt.json'),
      JSON.stringify({
        version: 1,
        key: options.key,
        digest,
        files,
        sources: unique,
      } satisfies Receipt),
    );
    await fs.rm(outputs, { force: true });
    await fs.rm(sources, { force: true });
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rename(temporary, directory);
    return { reused: false, digest, files: names };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
