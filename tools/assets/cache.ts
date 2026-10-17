import { onAsyncExit } from '../scope-exit';
import { readJson, writeJson } from '../json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { safeRelative } from './files';
import { cacheRoot, CACHE_LIMIT, projectRoot } from './paths';

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
async function diskUsage(
  root: string,
  physicalSeen = new Set<string>(),
  logicalSeen = new Set<string>(),
): Promise<{ logical: number; physical: number }> {
  let logical = 0,
    physical = 0;
  const pending = [root];
  // Bound both directory and file metadata requests. Library pages are spread
  // across thousands of small directories, rather than one flat file list.
  while (pending.length) {
    await Promise.all(
      pending.splice(0, 16).map(async (directory) => {
        let names;
        try {
          names = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        for (let offset = 0; offset < names.length; offset += 64) {
          const batch = names.slice(offset, offset + 64);
          if (batch.some((entry) => entry.isSymbolicLink()))
            throw new Error('Cache contains a symbolic link');
          const stats = await Promise.all(
            batch.map((entry) =>
              entry.isDirectory()
                ? Promise.resolve(undefined)
                : fs
                    .stat(path.join(directory, entry.name))
                    .catch((error: NodeJS.ErrnoException) => {
                      if (error.code === 'ENOENT') return undefined;
                      throw error;
                    }),
            ),
          );
          for (const [index, entry] of batch.entries()) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) pending.push(file);
            else {
              // Candidate writers atomically replace files during lease acquisition.
              const stat = stats[index];
              if (!stat) continue;
              const key = stat.ino ? `${stat.dev}:${stat.ino}` : file;
              if (!logicalSeen.has(key)) {
                logicalSeen.add(key);
                logical += stat.size;
              }
              if (!physicalSeen.has(key)) {
                physicalSeen.add(key);
                physical += stat.size;
              }
            }
          }
        }
      }),
    );
  }
  return { logical, physical };
}
export async function diskBytes(root: string, seen = new Set<string>()) {
  return (await diskUsage(root, seen)).physical;
}
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
        )
          await fs.rm(path.join(entries, name), { recursive: true, force: true });
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
      path
        .resolve(root)
        .startsWith(
          path.join(
            process.env.ASSET_LIBRARY_ROOT ?? path.join(os.homedir(), 'Documents', 'Asset Library'),
          ),
        )
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
  private async entries() {
    const directory = path.join(this.root, 'entries');
    await fs.mkdir(directory, { recursive: true });
    const entries = [];
    const seen = new Set<string>();
    for (const name of await fs.readdir(directory)) {
      const root = path.join(directory, name);
      if (!(await fs.lstat(root)).isDirectory()) throw new Error('Unexpected cache entry');
      const leaseDir = path.join(root, '.leases');
      let used = false,
        reserved = 0;
      await fs.mkdir(leaseDir, { recursive: true });
      for (const lease of await this.leaseFiles(leaseDir)) {
        const file = path.join(leaseDir, lease),
          value = (await readJson(file)) as Owner & { bytes: number };
        if (alive(value)) {
          used = true;
          reserved = Math.max(reserved, value.bytes);
        } else await fs.unlink(file);
      }
      const { logical, physical } = await diskUsage(root, seen);
      entries.push({
        name,
        root,
        used,
        bytes: Math.max(logical, reserved),
        logical,
        physical,
        reserved,
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
    const required = () =>
      entries.reduce(
        (sum, e) =>
          sum +
          e.physical +
          Math.max(0, (e.name === name ? Math.max(bytes, e.reserved) : e.reserved) - e.logical),
        0,
      ) + (entries.some((e) => e.name === name) ? 0 : bytes);
    const overhead = await this.overheadBytes();
    let total = overhead + required();
    const evictable = entries.filter((e) => e.name !== name && !e.used).sort((a, b) => a.at - b.at);
    for (const e of evictable) {
      if (total <= this.limit) break;
      await fs.rm(e.root, { recursive: true, force: true });
      // Shared inodes may still belong to a live entry after this path is removed.
      entries = await this.entries();
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
  async lease(name: string, bytes = 0, exclusive = false) {
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
      await this.writeJSON(file, { ...owner(), bytes });
      await fs.utimes(root, new Date(), new Date());
    });
    let released = false;
    return {
      root,
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
          await this.makeRoom(name, bytes);
          await this.writeJSON(file, { ...owner(), bytes });
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
          const granted = await this.makeRoom(name, bytes, undefined, preferred);
          await this.writeJSON(file, { ...owner(), bytes: granted });
          return granted;
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
      return (
        (await this.overheadBytes()) +
        entries.reduce((sum, e) => sum + e.physical + Math.max(0, e.reserved - e.logical), 0)
      );
    });
  }
}
