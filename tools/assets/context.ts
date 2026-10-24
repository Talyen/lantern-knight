import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { projectRoot, sourceLibrary, sourceLibraryRoot } from './paths';
import { readLibrarySource as libraryRead, sourceGroup } from './sources';
import { compile as compileAtlas } from '../compiler';
import type { Manifest } from '../../src/assets/schema';
import { runProcess as invokeProcess } from '../run-process';
import { safeRelative, exactSource as readExactSource } from './files';
import { forEachFile } from './file-batches';
import { fileChecksums, fileSignature, type VerifiedFiles } from '../verified-files';

export type PreparationOptions = {
  workspace: string;
  budget: number;
  sourceRoot: string;
  libraryRoot: string;
  outputLog?: string;
  inputLog?: string;
  environment?: NodeJS.ProcessEnv;
  knownContent?: Record<string, string>;
  reserveGrowth?: (bytes: number) => Promise<void>;
};
export type PreparationContext = Awaited<ReturnType<typeof createPreparationContext>>;
export async function createPreparationContext(options: PreparationOptions) {
  if (!Number.isFinite(options.budget) || options.budget < 0)
    throw new Error('Invalid preparation budget');
  const root = path.resolve(options.workspace);
  let bytes = 0,
    pending = Promise.resolve();
  let allocated = 0;
  const links = new Map<string, { count: number; size: number }>();
  const identities = new Map<string, string>();
  const contents = new Map<string, { file: string; key: string }>();
  const expectedOutputs = new Map<string, string>();
  const verified: VerifiedFiles = new Map();
  const verifiedInodes = new Map<string, string>();
  const outputRecords = new Set<string>();
  const initialSignatures = new Map<string, string>();
  const inode = (stat: { dev: number; ino: number }, file: string) =>
    stat.ino ? `${stat.dev}:${stat.ino}` : file;
  async function account(directory: string) {
    const directories = [directory];
    while (directories.length)
      await Promise.all(
        directories.splice(0, 16).map(async (directory) => {
          const entries = await fs
            .readdir(directory, { withFileTypes: true })
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return [];
              throw error;
            });
          for (let offset = 0; offset < entries.length; offset += 64) {
            const batch = entries.slice(offset, offset + 64);
            await Promise.all(
              batch.map(async (entry) => {
                const file = path.join(directory, entry.name);
                if (entry.isSymbolicLink()) throw new Error('Cache contains a symbolic link');
                if (entry.isDirectory()) {
                  directories.push(file);
                  return;
                }
                const stat = await fs.stat(file),
                  key = inode(stat, file),
                  existing = links.get(key);
                identities.set(file, key);
                initialSignatures.set(file, fileSignature(stat));
                if (existing) existing.count++;
                else {
                  links.set(key, { count: 1, size: stat.size });
                  bytes += stat.size;
                }
              }),
            );
          }
        }),
      );
  }
  await account(root);
  for (const [file, hash] of Object.entries(options.knownContent ?? {})) {
    const full = path.join(root, safeRelative(file)),
      key = identities.get(full);
    if (key) contents.set(hash, { file: full, key });
    const signature = initialSignatures.get(full);
    if (signature) {
      verified.set(file, { signature, hash });
      verifiedInodes.set(signature, hash);
    }
  }
  const resolve = (file: string) => {
    if (path.isAbsolute(file)) return file;
    return path.join(
      /^(public|staging|metadata)(\/|$)/.test(file) ? root : projectRoot,
      safeRelative(file),
    );
  };
  const source = (
    member: string,
    group = 'ink-collection-01',
    location?: { root: string; indexPath: string },
  ) =>
    libraryRead(member, group, {
      root: options.sourceRoot,
      indexPath:
        options.environment?.LANTERN_LIBRARY_INDEX ?? path.join(projectRoot, 'assets/sources.json'),
      strict: !!options.environment?.LANTERN_LIBRARY_INDEX,
      ...location,
      inputLog: options.inputLog ?? null,
    });
  const exactSource = async (file: string, base = path.join(root, 'staging')) => {
    safeRelative(file);
    if (base.startsWith('references/art/')) return source(file, sourceGroup(base));
    const directory = resolve(base);
    return readExactSource(file, directory);
  };
  const record = async (file: string, hash?: string) => {
    const relative = safeRelative(path.relative(root, resolve(file)).split(path.sep).join('/'));
    if (hash) expectedOutputs.set(relative, hash);
    if (options.outputLog) outputRecords.add(relative);
  };
  const writeAsset = (file: string, data: Buffer | string) => {
    pending = pending.then(async () => {
      const target = resolve(file);
      if (!target.startsWith(root + path.sep))
        throw new Error('Preparation output escapes workspace');
      const contentHash = createHash('sha256').update(data).digest('hex');
      if ((await context.verifiedHash(file)) === contentHash) {
        await record(target, contentHash);
        return;
      }
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
      const candidate = contents.get(contentHash);
      const candidateStat = candidate
        ? await fs.lstat(candidate.file).catch(() => undefined)
        : undefined;
      const shared =
        candidate &&
        candidateStat?.isFile() &&
        !candidateStat.isSymbolicLink() &&
        inode(candidateStat, candidate.file) === candidate.key &&
        verifiedInodes.get(fileSignature(candidateStat)) === contentHash &&
        identities.get(candidate.file) === candidate.key
          ? candidate
          : undefined;
      if (shared && shared.key === priorKey) {
        await record(target, contentHash);
        return;
      }
      const next =
        bytes -
        (priorLinks?.count === 1 ? priorLinks.size : 0) +
        (shared ? 0 : Buffer.byteLength(data));
      if (next > options.budget) throw new Error('Asset preparation exceeds reserved cache space');
      if (!shared) {
        allocated += Buffer.byteLength(data);
        await options.reserveGrowth?.(allocated);
      }
      const temporary = target + '.write-' + randomUUID();
      try {
        if (shared) await fs.link(shared.file, temporary);
        else await fs.writeFile(temporary, data);
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      if (priorLinks && --priorLinks.count === 0) links.delete(priorKey!);
      const installed = await fs.stat(target),
        installedKey = inode(installed, target);
      identities.set(target, installedKey);
      const existing = links.get(installedKey);
      if (existing) existing.count++;
      else links.set(installedKey, { count: 1, size: installed.size });
      contents.set(contentHash, { file: target, key: installedKey });
      const relative = path.relative(root, target).split(path.sep).join('/');
      verified.set(relative, { hash: contentHash, signature: fileSignature(installed) });
      verifiedInodes.set(fileSignature(installed), contentHash);
      bytes = next;
      await record(target, contentHash);
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
    sourceRoot: options.sourceRoot,
    environment: options.environment ?? process.env,
    path: resolve,
    stagingFile: (file: string) => path.join(root, 'staging', safeRelative(file)),
    readAsset,
    // The workspace has one writer; subprocess adoption refreshes this inventory.
    hasAsset: (file: string) => identities.has(resolve(file)),
    writeAsset,
    exactSource,
    readLibrarySource: source,
    record,
    checksums: (names: readonly string[]) => fileChecksums(root, names, verified),
    async verifiedHash(file: string) {
      const relative = safeRelative(path.relative(root, resolve(file)).split(path.sep).join('/'));
      const stat = await fs.lstat(resolve(file)).catch(() => undefined);
      if (!stat?.isFile()) return;
      const signature = fileSignature(stat),
        prior = verified.get(relative);
      return signature === prior?.signature ? prior.hash : verifiedInodes.get(signature);
    },
    async verifyOutputs(hashes: Readonly<Record<string, string>>) {
      await pending;
      for (const [file, expected] of expectedOutputs)
        if (hashes[file] !== expected) throw new Error('Prepared output bytes differ: ' + file);
      expectedOutputs.clear();
    },
    async recordContentHash(file: string, hash: string) {
      await pending;
      const resolved = resolve(file),
        stat = await fs.lstat(resolved),
        key = inode(stat, resolved);
      if (!stat.isFile() || stat.isSymbolicLink() || identities.get(resolved) !== key)
        throw new Error('Prepared content changed during verification');
      contents.set(hash, { file: resolved, key });
      verified.set(file, { hash, signature: fileSignature(stat) });
      verifiedInodes.set(fileSignature(stat), hash);
    },
    mkdirAsset: (file: string, mkdirOptions: { recursive?: boolean }) =>
      fs.mkdir(resolve(file), mkdirOptions),
    setReceipts(logs: { outputLog?: string; inputLog?: string }) {
      if (outputRecords.size) throw new Error('Preparation output receipts were not flushed');
      options.outputLog = logs.outputLog;
      options.inputLog = logs.inputLog;
    },
    async flushReceipts() {
      await pending;
      if (options.outputLog)
        await fs.appendFile(options.outputLog, [...outputRecords].join('\n') + '\n');
      outputRecords.clear();
    },
    async adopt(files: readonly string[], hashes?: Readonly<Record<string, string>>) {
      await pending;
      await forEachFile(files, async (relative) => {
        const file = path.join(root, safeRelative(relative)),
          stat = await fs.lstat(file),
          key = inode(stat, file);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error('Invalid cached preparation output');
        const oldKey = identities.get(file);
        if (oldKey === key) {
          if (links.get(key)?.size !== stat.size)
            throw new Error('Cached preparation output changed during adoption');
        } else {
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
        const hash = hashes?.[relative];
        if (hash) {
          contents.set(hash, { file, key });
          verified.set(relative, { hash, signature: fileSignature(stat) });
          verifiedInodes.set(fileSignature(stat), hash);
        }
      });
      if (bytes > options.budget) throw new Error('Asset preparation exceeds reserved cache space');
    },
    compile: async (
      sourceFile: string,
      out: string,
      validateOnly = false,
      inputRoot = path.join(root, 'staging'),
    ): Promise<Manifest> => {
      const result = await compileAtlas(context, sourceFile, out, validateOnly, inputRoot);
      await context.flushReceipts();
      return result;
    },
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
    libraryRoot: sourceLibraryRoot(),
    outputLog: env.LANTERN_STEP_OUTPUT_LOG,
    inputLog: env.LANTERN_STEP_INPUT_LOG,
    environment: env,
  };
}
