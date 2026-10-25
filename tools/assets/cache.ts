import { onAsyncExit } from '../scope-exit';
import { readJson, writeJson } from '../json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { safeRelative } from './files';
import { cacheRoot, CACHE_LIMIT, projectRoot, sourceLibraryRoot } from './paths';

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
type Footprint = [string, number][];
async function footprint(root: string, omitLeases = false): Promise<Footprint> {
  const files = new Map<string, number>();
  const pending = [root];
  while (pending.length) {
    await Promise.all(
      pending.splice(-16).map(async (directory) => {
        let names;
        try {
          names = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        for (let offset = 0; offset < names.length; offset += 64) {
          await Promise.all(
            names.slice(offset, offset + 64).map(async (entry) => {
              if (entry.isSymbolicLink()) throw new Error('Cache contains a symbolic link');
              const file = path.join(directory, entry.name);
              if (entry.isDirectory()) {
                if (!(omitLeases && directory === root && entry.name === '.leases'))
                  pending.push(file);
                return;
              }
              const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return undefined;
                throw error;
              });
              if (!stat) return;
              if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected cache file');
              files.set(stat.ino ? `${stat.dev}:${stat.ino}` : file, stat.size);
            }),
          );
        }
      }),
    );
  }
  return [...files];
}
export async function diskBytes(root: string, seen = new Set<string>()) {
  let bytes = 0;
  for (const [key, size] of await footprint(root))
    if (!seen.has(key)) {
      seen.add(key);
      bytes += size;
    }
  return bytes;
}
const stamp = async (root: string) => {
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unexpected cache entry');
  return `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`;
};
export class AssetCache {
  async prunePreviews(prefix: string, current: string) {
    if (!/^preview-[a-f0-9]{20}$/.test(prefix) || !current.startsWith(prefix + '-'))
      throw new Error('Invalid preview cleanup scope');
    return this.locked(async () => {
      const entries = path.join(this.root, 'entries');
      const active = async (name: string) => {
        const directory = path.join(entries, name, '.leases');
        const names = await this.leaseFiles(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
        for (const file of names)
          if (alive(await readJson(path.join(directory, file)))) return true;
        return false;
      };
      if (await active(prefix + '-index')) return;
      for (const name of await fs.readdir(entries))
        if (
          name.startsWith(prefix + '-') &&
          name !== current &&
          name !== prefix + '-index' &&
          !(await active(name))
        ) {
          await fs.rm(path.join(entries, name), { recursive: true, force: true });
          await fs.rm(this.inventoryFile(name), { force: true });
        }
    });
  }
  constructor(
    readonly root = cacheRoot(),
    readonly limit = CACHE_LIMIT,
  ) {
    if (
      path.resolve(root) === path.parse(path.resolve(root)).root ||
      path.resolve(root) === os.homedir() ||
      path.resolve(root) === projectRoot.replace(/[/\\]$/, '') ||
      path.resolve(root).startsWith(projectRoot) ||
      path.resolve(root).startsWith(sourceLibraryRoot())
    )
      throw new Error('Asset cache must be separate from project and source storage');
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error('Cache budget must be a positive byte count');
  }
  // Task reports share this root but do not acquire artwork or a pack lease.
  async initialize() {
    await this.locked(async () => {});
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true });
    const marker = path.join(this.root, '.cache-owner.json');
    try {
      const value = await readJson(marker);
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
    const started = Date.now();
    for (;;) {
      try {
        await fs.mkdir(lock);
        await writeJson(path.join(lock, 'owner.json'), owner());
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const held = await readJson(path.join(lock, 'owner.json'));
          if (!alive(held)) {
            await fs.rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
            throw error;
          const stat = await fs.stat(lock).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          });
          if (!stat) continue;
          if (Date.now() - stat.mtimeMs > 30000) {
            await fs.rm(lock, { recursive: true, force: true });
            continue;
          }
        }
        // A complete library accounting/eviction pass can outlast ten seconds.
        // Readers and cleanup wait for its live owner instead of restarting work.
        if (Date.now() - started >= 5 * 60_000)
          throw new Error('Asset cache is busy; retry after the current operation');
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    await using _cleanup1 = onAsyncExit(() => fs.rm(lock, { recursive: true, force: true }));
    return await work();
  }
  private inventoryFile(name: string) {
    return path.join(this.root, '.inventory', name + '.json.gz');
  }
  private async inventory(root: string, mutable: boolean) {
    const file = this.inventoryFile(path.basename(root));
    const signature = await stamp(root);
    if (!mutable) {
      try {
        const value = JSON.parse(
          gunzipSync(await fs.readFile(file), { maxOutputLength: 128 * 1024 ** 2 }).toString(),
        );
        if (
          value.version === 1 &&
          value.stamp === signature &&
          Array.isArray(value.files) &&
          value.files.every(
            (item: unknown) =>
              Array.isArray(item) &&
              item.length === 2 &&
              typeof item[0] === 'string' &&
              Number.isSafeInteger(item[1]) &&
              item[1] >= 0,
          )
        )
          return value.files as Footprint;
      } catch (error) {
        // The inventory is disposable accounting metadata. Missing or damaged
        // records are rebuilt from the entry, never trusted as zero bytes.
        if ((error as NodeJS.ErrnoException).code === 'EACCES') throw error;
      }
    }
    const files = await footprint(root, true);
    if (!mutable) await this.saveInventory(root, files);
    return files;
  }
  private async saveInventory(root: string, files: Footprint) {
    const file = this.inventoryFile(path.basename(root));
    const body = gzipSync(
      Buffer.from(JSON.stringify({ version: 1, stamp: await stamp(root), files })),
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, body);
      await fs.rename(temporary, file);
    } catch (error) {
      if (!['ENOSPC', 'EDQUOT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      // A disposable index must not turn successful lease release into a disk
      // allocation failure. Its absence forces filesystem accounting next time.
      await fs.rm(file, { force: true });
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  private async entries() {
    const directory = path.join(this.root, 'entries');
    await fs.mkdir(directory, { recursive: true });
    const entries = [];
    for (const name of await fs.readdir(directory)) {
      const root = path.join(directory, name);
      await stamp(root);
      const leaseDir = path.join(root, '.leases');
      let used = false,
        mutable = false,
        abandonedWriter = false,
        reserved = 0;
      await fs.mkdir(leaseDir, { recursive: true });
      for (const lease of await this.leaseFiles(leaseDir)) {
        const file = path.join(leaseDir, lease),
          value = (await readJson(file)) as Owner & { bytes: number; readOnly?: boolean };
        if (alive(value)) {
          used = true;
          mutable ||= value.readOnly !== true;
          reserved = Math.max(reserved, value.bytes);
        } else {
          abandonedWriter ||= value.readOnly !== true;
          await fs.unlink(file);
        }
      }
      const data = await this.inventory(root, mutable || abandonedWriter);
      if (abandonedWriter && !mutable) await this.saveInventory(root, data);
      const files = new Map(data);
      for (const [key, bytes] of await footprint(leaseDir)) files.set(key, bytes);
      const logical = [...files.values()].reduce((a, b) => a + b, 0);
      entries.push({
        name,
        root,
        used,
        bytes: Math.max(logical, reserved),
        logical,
        files,
        reserved,
        at: Math.max((await fs.stat(root)).mtimeMs, (await fs.stat(leaseDir)).mtimeMs),
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
    await using _cleanup2 = onAsyncExit(() => fs.rm(temporary, { force: true }));
    await writeJson(temporary, value);
    await fs.rename(temporary, file);
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
    preferred = bytes,
  ) {
    let entries = knownEntries ?? (await this.entries());
    // Count shared inodes once and retain their references through eviction.
    // Removing a hardlink must not subtract bytes still owned by another entry.
    const inodes = new Map<string, { bytes: number; references: number }>();
    for (const entry of entries)
      for (const [key, size] of entry.files) {
        const old = inodes.get(key);
        inodes.set(key, {
          bytes: Math.max(size, old?.bytes ?? 0),
          references: (old?.references ?? 0) + 1,
        });
      }
    const required = () =>
      [...inodes.values()].reduce((sum, inode) => sum + inode.bytes, 0) +
      entries.reduce(
        (sum, e) =>
          sum +
          Math.max(0, (e.name === name ? Math.max(bytes, e.reserved) : e.reserved) - e.logical),
        0,
      ) +
      (entries.some((e) => e.name === name) ? 0 : bytes);
    let overhead = await this.overheadBytes();
    let total = overhead + required();
    const evictable = entries.filter((e) => e.name !== name && !e.used).sort((a, b) => a.at - b.at);
    for (const e of evictable) {
      if (total <= this.limit) break;
      await fs.rm(e.root, { recursive: true, force: true });
      await fs.rm(this.inventoryFile(e.name), { force: true });
      for (const key of e.files.keys()) {
        const inode = inodes.get(key)!;
        if (--inode.references === 0) inodes.delete(key);
      }
      entries = entries.filter((entry) => entry !== e);
      overhead = await this.overheadBytes();
      total = overhead + required();
    }
    if (total > this.limit)
      throw new Error(
        `Asset operation cannot fit in the ${(this.limit / 1024 ** 3).toFixed(2)} GiB cache budget; active files are protected. Increase LANTERN_CACHE_BUDGET_GIB or close unused previews.`,
      );
    const disk = await fs.statfs(this.root);
    const existing = entries.find((e) => e.name === name)?.bytes ?? 0;
    const free = disk.bavail * disk.bsize;
    if (free < Math.max(0, bytes - existing))
      throw new Error(
        'Insufficient free disk space for the requested asset operation; existing assets are preserved',
      );
    // Grant available headroom in one accounting pass. Near the limit, an
    // exact-byte fallback must not turn every output into two full cache walks.
    return Math.floor(
      Math.min(
        preferred,
        Math.max(bytes, bytes + this.limit - total - 256),
        Math.max(bytes, existing) + free,
      ),
    );
  }
  async lease(name: string, bytes = 0, exclusive = false, readOnly = false) {
    safeRelative(name);
    if (name.includes('/')) throw new Error('Cache entry name must be a single component');
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit)
      throw new Error('Asset operation exceeds cache budget');
    const token = randomUUID(),
      root = path.join(this.root, 'entries', name),
      file = path.join(root, '.leases', token + '.json');
    await this.locked(async () => {
      const reader =
        bytes === 0
          ? await fs.lstat(root).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return undefined;
              throw error;
            })
          : undefined;
      if (reader && (!reader.isDirectory() || reader.isSymbolicLink()))
        throw new Error('Invalid cache entry');
      if (bytes === 0 && exclusive && reader) {
        const leases = await this.leaseFiles(path.join(root, '.leases')).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return [];
            throw error;
          },
        );
        for (const lease of leases) {
          const value = (await readJson(path.join(root, '.leases', lease))) as Owner;
          if (alive(value)) throw new Error('Asset preparation is already in use');
        }
      }
      // A zero-byte lease adds only ownership metadata. Actual growth is
      // checked by reservations, including final activation of a prepared layer.
      if (bytes !== 0) {
        const entries = await this.entries(),
          existing = entries.find((e) => e.name === name);
        if (exclusive && existing?.used) throw new Error('Asset preparation is already in use');
        await this.makeRoom(name, Math.max(bytes, existing?.bytes ?? 0), entries);
      }
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Reader activity lives under .leases. Touching the payload root forced
      // every reader to decompress and recompress its complete inode inventory.
      if (!readOnly) await fs.rm(this.inventoryFile(name), { force: true });
      await this.writeJSON(file, { ...owner(), bytes, readOnly });
    });
    let released = false;
    return {
      root,
      residentBytes: () =>
        this.locked(async () => {
          let mutable = false;
          for (const peer of await this.leaseFiles(path.dirname(file))) {
            const value = await readJson(path.join(path.dirname(file), peer));
            if (value.readOnly !== true) mutable = true;
          }
          const data = await this.inventory(root, mutable);
          return (
            data.reduce((sum, item) => sum + item[1], 0) + (await diskBytes(path.dirname(file)))
          );
        }),
      sole: async () =>
        this.locked(async () => {
          for (const entry of await this.leaseFiles(path.dirname(file)))
            if (entry !== path.basename(file)) {
              const peer = await readJson(path.join(path.dirname(file), entry));
              if (alive(peer)) return false;
            }
          return true;
        }),
      reserve: async (bytes: number) => {
        if (released || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit)
          throw new Error('Invalid cache reservation');
        await this.locked(async () => {
          // Release can win the mutex while this reservation waits for admission.
          if (released) throw new Error('Invalid cache reservation');
          await this.makeRoom(name, bytes);
          await this.writeJSON(file, { ...owner(), bytes, readOnly: false });
          readOnly = false;
          await fs.rm(this.inventoryFile(name), { force: true });
        });
      },
      reserveUpTo: async (bytes: number, preferred: number) => {
        if (
          released ||
          !Number.isSafeInteger(bytes) ||
          bytes < 0 ||
          bytes > this.limit ||
          !Number.isSafeInteger(preferred) ||
          preferred < bytes
        )
          throw new Error('Invalid cache reservation');
        return this.locked(async () => {
          if (released) throw new Error('Invalid cache reservation');
          const granted = await this.makeRoom(name, bytes, undefined, preferred);
          await this.writeJSON(file, { ...owner(), bytes: granted, readOnly: false });
          readOnly = false;
          await fs.rm(this.inventoryFile(name), { force: true });
          return granted;
        });
      },
      release: async () => {
        if (released) return;
        released = true;
        await this.locked(async () => {
          await fs.rm(file, { force: true });
          // A reader changes ownership metadata only. Inventory misses and root
          // changes are rebuilt lazily by the next budget/accounting operation.
          if (readOnly) return;
          const peers = await this.leaseFiles(path.dirname(file));
          for (const peer of peers) {
            const value = await readJson(path.join(path.dirname(file), peer));
            if (alive(value) && value.readOnly !== true) return;
          }
          // Writers close only after their admitted writes settle. Refresh just
          // this entry once; unrelated immutable payloads retain their inventory.
          await this.inventory(root, true).then((files) => this.saveInventory(root, files));
        });
      },
    };
  }
  async reserve(name: string, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit)
      throw new Error('Invalid cache reservation');
    await this.locked(() => this.makeRoom(name, bytes));
  }
  async clean(keep: ReadonlySet<string> = new Set(), dryRun = false) {
    return this.locked(async () => {
      let removed = 0;
      for (const e of await this.entries())
        if (!e.used && !keep.has(e.name)) {
          if (!dryRun) {
            await fs.rm(e.root, { recursive: true, force: true });
            await fs.rm(this.inventoryFile(e.name), { force: true });
          }
          removed++;
        }
      return removed;
    });
  }
  async usage() {
    return this.locked(async () => {
      const entries = await this.entries();
      return (
        (await this.overheadBytes()) +
        [
          ...entries
            .reduce((files, entry) => {
              for (const [key, bytes] of entry.files)
                files.set(key, Math.max(bytes, files.get(key) ?? 0));
              return files;
            }, new Map<string, number>())
            .values(),
        ].reduce((a, b) => a + b, 0) +
        entries.reduce((sum, e) => sum + Math.max(0, e.reserved - e.logical), 0)
      );
    });
  }
}
