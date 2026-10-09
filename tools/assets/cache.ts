import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { cacheRoot, CACHE_LIMIT, safeRelative, projectRoot } from './paths';

type Owner = { pid: number; host: string };
const owner = (): Owner => ({ pid: process.pid, host: os.hostname() });
function alive(value: Owner) {
  if (value.host !== os.hostname()) return true;
  try {
    process.kill(value.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
export async function diskBytes(root: string, seen = new Set<string>()): Promise<number> {
  let names;
  try {
    names = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const e of names) {
    const file = path.join(root, e.name);
    if (e.isSymbolicLink()) throw new Error('Cache contains a symbolic link');
    if (e.isDirectory()) total += await diskBytes(file, seen);
    else {
      const stat = await fs.stat(file),
        key = stat.ino ? `${stat.dev}:${stat.ino}` : file;
      if (!seen.has(key)) {
        seen.add(key);
        total += stat.size;
      }
    }
  }
  return total;
}
export class AssetCache {
  constructor(
    readonly root = cacheRoot(),
    readonly limit = CACHE_LIMIT,
  ) {
    if (
      path.resolve(root) === path.parse(path.resolve(root)).root ||
      path.resolve(root) === os.homedir() ||
      path.resolve(root) === projectRoot.replace(/[/\\]$/, '') ||
      path.resolve(root).startsWith(projectRoot) ||
      path
        .resolve(root)
        .startsWith(
          path.join(
            process.env.ASSET_LIBRARY_ROOT ?? path.join(os.homedir(), 'Documents', 'Asset Library'),
          ),
        )
    )
      throw new Error('Asset cache must be separate from project and source storage');
    if (limit <= 0 || limit > CACHE_LIMIT)
      throw new Error('Cache budget must be between 1 byte and 4 GiB');
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true });
    const marker = path.join(this.root, '.cache-owner.json');
    try {
      const value = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (value.project !== 'lantern-knight' || value.schemaVersion !== 1)
        throw new Error('Invalid cache ownership marker');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      for (const name of await fs.readdir(this.root))
        if (
          ![
            'entries',
            '.mutex',
            'source-locations.json',
            'source-locations.lock',
            '.DS_Store',
          ].includes(name) &&
          !name.startsWith('.source-locations-') &&
          !/^\.cache-owner-[a-f0-9-]{36}\.tmp$/.test(name)
        )
          throw new Error('Cache location contains unrelated files');
      await this.writeJSON(
        marker,
        { schemaVersion: 1, project: 'lantern-knight' },
        path.join(this.root, '.cache-owner-' + randomUUID() + '.tmp'),
      );
    }
    const lock = path.join(this.root, '.mutex');
    for (let n = 0; ; n++) {
      try {
        await fs.mkdir(lock);
        await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(owner()));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const held = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
          if (!alive(held)) {
            await fs.rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
            throw error;
          if (Date.now() - (await fs.stat(lock)).mtimeMs > 30000) {
            await fs.rm(lock, { recursive: true, force: true });
            continue;
          }
        }
        if (n >= 200) throw new Error('Asset cache is busy; retry after the current operation');
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    try {
      return await work();
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
  private async entries() {
    const directory = path.join(this.root, 'entries');
    await fs.mkdir(directory, { recursive: true });
    const entries = [];
    for (const name of await fs.readdir(directory)) {
      const root = path.join(directory, name);
      if (!(await fs.lstat(root)).isDirectory()) throw new Error('Unexpected cache entry');
      const leaseDir = path.join(root, '.leases');
      let used = false,
        reserved = 0;
      await fs.mkdir(leaseDir, { recursive: true });
      for (const lease of await this.leaseFiles(leaseDir)) {
        const file = path.join(leaseDir, lease),
          value = JSON.parse(await fs.readFile(file, 'utf8')) as Owner & { bytes: number };
        if (alive(value)) {
          used = true;
          reserved = Math.max(reserved, value.bytes);
        } else await fs.unlink(file);
      }
      entries.push({
        name,
        root,
        used,
        bytes: Math.max(await diskBytes(root), reserved),
        at: (await fs.stat(root)).mtimeMs,
      });
    }
    return entries;
  }
  // Called under the mutex: abandoned unpublished records have no active writer.
  private async leaseFiles(directory: string) {
    const names = await fs.readdir(directory);
    for (const name of names.filter((name) => name.endsWith('.json.tmp')))
      await fs.rm(path.join(directory, name), { force: true });
    return names.filter((name) => !name.endsWith('.json.tmp'));
  }
  private async writeJSON(file: string, value: unknown, temporary = file + '.tmp') {
    try {
      await fs.writeFile(temporary, JSON.stringify(value));
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  private async overheadBytes() {
    let overhead = 0;
    for (const e of await fs.readdir(this.root, { withFileTypes: true }))
      if (e.name !== 'entries')
        overhead += e.isDirectory()
          ? await diskBytes(path.join(this.root, e.name))
          : (await fs.stat(path.join(this.root, e.name))).size;
    return overhead;
  }
  private async makeRoom(
    name: string,
    bytes: number,
    knownEntries?: Awaited<ReturnType<AssetCache['entries']>>,
  ) {
    const entries = knownEntries ?? (await this.entries());
    let total =
      (await this.overheadBytes()) +
      entries.filter((e) => e.name !== name).reduce((sum, e) => sum + e.bytes, 0) +
      bytes;
    for (const e of entries.filter((e) => e.name !== name && !e.used).sort((a, b) => a.at - b.at)) {
      if (total <= this.limit) break;
      await fs.rm(e.root, { recursive: true, force: true });
      total -= e.bytes;
    }
    if (total > this.limit)
      throw new Error(
        `Asset operation cannot fit in the ${this.limit === CACHE_LIMIT ? '4 GiB' : this.limit + ' byte'} cache budget; active files are protected`,
      );
  }
  async lease(name: string, bytes = 0, exclusive = false) {
    safeRelative(name);
    if (name.includes('/')) throw new Error('Cache entry name must be a single component');
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit)
      throw new Error('Asset operation exceeds cache budget');
    const token = randomUUID(),
      root = path.join(this.root, 'entries', name),
      file = path.join(root, '.leases', token + '.json');
    await this.locked(async () => {
      const entries = await this.entries(),
        existing = entries.find((e) => e.name === name);
      if (exclusive && existing?.used) throw new Error('Asset preparation is already in use');
      await this.makeRoom(name, Math.max(bytes, existing?.bytes ?? 0), entries);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await this.writeJSON(file, { ...owner(), bytes });
      await fs.utimes(root, new Date(), new Date());
    });
    let released = false;
    return {
      root,
      sole: async () => {
        return this.locked(async () => {
          for (const entry of await this.leaseFiles(path.dirname(file)))
            if (entry !== path.basename(file)) {
              const peer = JSON.parse(
                await fs.readFile(path.join(path.dirname(file), entry), 'utf8'),
              );
              if (alive(peer)) return false;
            }
          return true;
        });
      },
      reserve: async (bytes: number) => {
        if (released || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit)
          throw new Error('Invalid cache reservation');
        await this.locked(async () => {
          await this.makeRoom(name, bytes);
          await this.writeJSON(file, { ...owner(), bytes });
        });
      },
      release: async () => {
        if (released) return;
        released = true;
        await this.locked(() => fs.rm(file, { force: true }));
      },
    };
  }
  async reserve(name: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit)
      throw new Error('Invalid cache reservation');
    await this.locked(() => this.makeRoom(name, bytes));
  }
  async clean(keep: ReadonlySet<string> = new Set()) {
    return this.locked(async () => {
      let removed = 0;
      for (const e of await this.entries())
        if (!e.used && !keep.has(e.name)) {
          await fs.rm(e.root, { recursive: true, force: true });
          removed++;
        }
      return removed;
    });
  }
  async usage() {
    return this.locked(async () => {
      const entries = await this.entries();
      return (await this.overheadBytes()) + entries.reduce((sum, e) => sum + e.bytes, 0);
    });
  }
}
