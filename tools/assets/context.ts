import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { projectRoot, safeRelative, sourceLibrary } from './paths';
import { readLibrarySource as libraryRead, sourceGroup } from './sources';
import { compile as compileAtlas } from '../compiler';
import type { Manifest } from '../../src/assets/schema';
import { runProcess as invokeProcess } from '../run-process';

export type PreparationOptions = {
  workspace: string;
  budget: number;
  sourceRoot: string;
  libraryRoot: string;
  outputLog?: string;
  inputLog?: string;
  environment?: NodeJS.ProcessEnv;
};
export type PreparationContext = Awaited<ReturnType<typeof createPreparationContext>>;
export async function createPreparationContext(options: PreparationOptions) {
  if (!Number.isFinite(options.budget) || options.budget < 0)
    throw new Error('Invalid preparation budget');
  const root = path.resolve(options.workspace);
  let bytes = 0,
    pending = Promise.resolve();
  const links = new Map<string, { count: number; size: number }>();
  const identities = new Map<string, string>();
  const inode = (stat: { dev: number; ino: number }, file: string) =>
    stat.ino ? `${stat.dev}:${stat.ino}` : file;
  async function account(directory: string) {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Cache contains a symbolic link');
      if (entry.isDirectory()) await account(file);
      else {
        const stat = await fs.stat(file),
          key = inode(stat, file),
          existing = links.get(key);
        identities.set(file, key);
        if (existing) existing.count++;
        else {
          links.set(key, { count: 1, size: stat.size });
          bytes += stat.size;
        }
      }
    }
  }
  await account(root);
  const resolve = (file: string) => {
    if (path.isAbsolute(file)) return file;
    return path.join(/^(public|staging)(\/|$)/.test(file) ? root : projectRoot, safeRelative(file));
  };
  const source = (
    member: string,
    group = 'ink-collection-01',
    location?: { root: string; indexPath: string },
  ) =>
    libraryRead(member, group, {
      root: options.sourceRoot,
      indexPath: path.join(projectRoot, 'assets/sources.json'),
      ...location,
      inputLog: options.inputLog ?? null,
    });
  const exactSource = async (file: string, base = path.join(root, 'staging')) => {
    safeRelative(file);
    if (base.startsWith('references/art/')) return source(file, sourceGroup(base));
    const directory = resolve(base);
    let current = directory;
    for (const part of file.split('/')) {
      if (!(await fs.readdir(current)).includes(part))
        throw new Error('exact filename case or missing file: ' + file);
      current = path.join(current, part);
    }
    const real = await fs.realpath(current),
      baseReal = await fs.realpath(directory);
    if (!real.startsWith(baseReal + path.sep))
      throw new Error('source escapes approved root: ' + file);
    return fs.readFile(current);
  };
  const record = async (file: string) => {
    const relative = safeRelative(path.relative(root, resolve(file)).split(path.sep).join('/'));
    if (options.outputLog) await fs.appendFile(options.outputLog, relative + '\n');
  };
  const writeAsset = (file: string, data: Buffer | string) => {
    pending = pending.then(async () => {
      const target = resolve(file);
      if (!target.startsWith(root + path.sep))
        throw new Error('Preparation output escapes workspace');
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (
        !(await fs.realpath(path.dirname(target))).startsWith((await fs.realpath(root)) + path.sep)
      )
        throw new Error('Preparation output follows a symlink');
      const prior = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (prior && (!prior.isFile() || prior.isSymbolicLink()))
        throw new Error('Invalid preparation output');
      const priorKey = prior ? inode(prior, target) : undefined;
      const priorLinks = priorKey ? links.get(priorKey) : undefined;
      if (prior && (identities.get(target) !== priorKey || priorLinks?.size !== prior.size))
        throw new Error('Preparation workspace changed outside its writer');
      const next =
        bytes - (priorLinks?.count === 1 ? priorLinks.size : 0) + Buffer.byteLength(data);
      if (next > options.budget) throw new Error('Asset preparation exceeds reserved cache space');
      const temporary = target + '.write-' + randomUUID();
      try {
        await fs.writeFile(temporary, data);
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      if (priorLinks && --priorLinks.count === 0) links.delete(priorKey!);
      const installed = await fs.stat(target),
        installedKey = inode(installed, target);
      identities.set(target, installedKey);
      links.set(installedKey, { count: 1, size: installed.size });
      bytes = next;
      await record(target);
    });
    return pending;
  };
  function readAsset(file: string): Promise<Buffer>;
  function readAsset(file: string, encoding: BufferEncoding): Promise<string>;
  async function readAsset(file: string, encoding?: BufferEncoding) {
    let data: Buffer;
    if (file.startsWith('references/art/')) {
      const [group, ...rest] = file.slice(15).split('/');
      data = await source(rest.join('/'), group!);
    } else data = await fs.readFile(resolve(file));
    return encoding ? data.toString(encoding) : data;
  }
  const context = {
    root,
    publicDirectory: path.join(root, 'public'),
    libraryRoot: options.libraryRoot,
    path: resolve,
    stagingFile: (file: string) => path.join(root, 'staging', safeRelative(file)),
    readAsset,
    writeAsset,
    exactSource,
    readLibrarySource: source,
    record,
    mkdirAsset: (file: string, mkdirOptions: { recursive?: boolean }) =>
      fs.mkdir(resolve(file), mkdirOptions),
    setReceipts(logs: { outputLog?: string; inputLog?: string }) {
      options.outputLog = logs.outputLog;
      options.inputLog = logs.inputLog;
    },
    async adopt(files: readonly string[]) {
      await pending;
      for (const relative of files) {
        const file = path.join(root, safeRelative(relative)),
          stat = await fs.lstat(file),
          key = inode(stat, file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error('Invalid cached preparation output');
        const oldKey = identities.get(file);
        if (oldKey === key) {
          if (links.get(key)?.size !== stat.size)
            throw new Error('Cached preparation output changed during adoption');
          continue;
        }
        const old = oldKey ? links.get(oldKey) : undefined;
        if (old && --old.count === 0) {
          bytes -= old.size;
          links.delete(oldKey!);
        }
        const installed = links.get(key);
        if (installed) installed.count++;
        else {
          links.set(key, { count: 1, size: stat.size });
          bytes += stat.size;
        }
        identities.set(file, key);
      }
      if (bytes > options.budget) throw new Error('Asset preparation exceeds reserved cache space');
    },
    compile: (
      sourceFile: string,
      out: string,
      production = false,
      validateOnly = false,
      inputRoot = path.join(root, 'staging'),
    ): Promise<Manifest> =>
      compileAtlas(sourceFile, out, production, validateOnly, inputRoot, context),
    runProcess: async (
      command: string,
      args: string[],
      processOptions: Parameters<typeof invokeProcess>[2],
    ) => {
      await pending;
      await invokeProcess(command, args, {
        ...processOptions,
        env: {
          ...options.environment,
          LANTERN_ASSET_WORKSPACE: root,
          LANTERN_PREPARING: '1',
          LANTERN_PREPARE_BUDGET: String(options.budget),
          LANTERN_STEP_OUTPUT_LOG: options.outputLog,
          LANTERN_STEP_INPUT_LOG: options.inputLog,
        },
      });
      bytes = 0;
      links.clear();
      identities.clear();
      await account(root);
      if (bytes > options.budget) throw new Error('Asset preparation exceeds reserved cache space');
    },
  };
  return context;
}
// Only command/subprocess boundaries translate environment variables.
export function preparationOptions(workspace: string, env: NodeJS.ProcessEnv): PreparationOptions {
  return {
    workspace,
    budget: Number(env.LANTERN_PREPARE_BUDGET ?? 3 * 1024 ** 3),
    sourceRoot: sourceLibrary(env),
    libraryRoot: env.ASSET_LIBRARY_ROOT ?? path.join(os.homedir(), 'Documents', 'Asset Library'),
    outputLog: env.LANTERN_STEP_OUTPUT_LOG,
    inputLog: env.LANTERN_STEP_INPUT_LOG,
    environment: env,
  };
}
