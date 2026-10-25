import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { acquireCommandLane } from '../command-lane';
import { diskBytes } from './cache';

const identityPattern = /^[a-f0-9]{64}$/;
const directory = (root: string) => path.join(root, '.cache/repository-assets');
type Policy = {
  keep: ReadonlySet<string>;
  budgetBytes?: number;
  maxAgeMs?: number;
  dryRun?: boolean;
  all?: boolean;
  reservation?: { identity: string; bytes: number };
};
async function locked<T>(root: string, action: () => Promise<T>) {
  const physical = await fs.realpath(root);
  const port = 50000 + (createHash('sha256').update(physical).digest().readUInt32BE(0) % 10000);
  const held = await acquireCommandLane({
    port,
    name: 'repository asset cache',
    waitMs: 30000,
  });
  try {
    return await action();
  } finally {
    await held.release();
  }
}
async function json(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ambiguous cache metadata');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function active(root: string) {
  const leases = path.join(root, '.leases');
  try {
    const stat = await fs.lstat(leases);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return true;
    for (const name of await fs.readdir(leases)) {
      let owner;
      try {
        owner = await json(path.join(leases, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        return true;
      }
      if (owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
        return true;
      try {
        process.kill(owner.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true;
      }
    }
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return true;
  }
}
async function prune(root: string, policy: Policy) {
  const budget =
    policy.budgetBytes ?? Number(process.env.LANTERN_REPOSITORY_CACHE_BUDGET_GIB ?? 4) * 1024 ** 3;
  const age = policy.maxAgeMs ?? 7 * 86400000;
  if (!Number.isSafeInteger(budget) || budget <= 0 || !Number.isFinite(age) || age < 0)
    throw new Error('Invalid repository cache retention policy');
  const base = directory(root);
  const entries: {
    identity: string;
    root: string;
    bytes: number;
    accessed: number;
    protected: boolean;
  }[] = [];
  const names = await fs.readdir(base).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (
    names.length &&
    (await fs.realpath(base)) !== path.join(await fs.realpath(root), '.cache/repository-assets')
  )
    throw new Error('Repository cache follows a symbolic link');
  for (const name of names) {
    if (!identityPattern.test(name)) continue;
    const entry = path.join(base, name);
    try {
      const stat = await fs.lstat(entry);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const marker = await json(path.join(entry, '.assembly.json'));
      if (
        marker.schemaVersion !== 1 ||
        marker.identity !== name ||
        !Number.isFinite(marker.accessed)
      )
        continue;
      entries.push({
        identity: name,
        root: entry,
        accessed: marker.accessed,
        bytes: await diskBytes(entry),
        protected: policy.keep.has(name) || (await active(entry)),
      });
    } catch {
      // Unknown, unmarked, corrupt or changing entries are never deletion authority.
    }
  }
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (policy.reservation) {
    const existing =
      entries.find((entry) => entry.identity === policy.reservation!.identity)?.bytes ?? 0;
    total += Math.max(0, policy.reservation.bytes - existing);
  }
  const removed: { identity: string; bytes: number }[] = [];
  for (const entry of entries.sort((a, b) => a.accessed - b.accessed)) {
    if (entry.protected || (!policy.all && total <= budget && Date.now() - entry.accessed <= age))
      continue;
    if (!policy.dryRun) {
      // Admission and removal use the same OS-owned lock; a reader installs its
      // lease before copying. Rename keeps a partially removed assembly closed.
      const retired = path.join(base, 'retired-' + entry.identity + '-' + randomUUID());
      await fs.rename(entry.root, retired);
      await fs.rm(retired, { recursive: true, force: true });
    }
    total -= entry.bytes;
    removed.push({ identity: entry.identity, bytes: entry.bytes });
  }
  return { removed, retainedBytes: total };
}
export async function cleanRepositoryAssemblies(root: string, policy: Policy) {
  return locked(root, () => prune(root, policy));
}

export async function leaseRepositoryAssembly(
  root: string,
  identity: string,
  expectedBytes: number,
) {
  if (!identityPattern.test(identity) || !Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
    throw new Error('Invalid repository assembly identity');
  let lease!: string;
  await locked(root, async () => {
    const base = directory(root);
    await fs.mkdir(base, { recursive: true });
    if (
      (await fs.realpath(base)) !== path.join(await fs.realpath(root), '.cache/repository-assets')
    )
      throw new Error('Repository cache follows a symbolic link');
    const assembly = path.join(base, identity);
    let fresh = false;
    try {
      await fs.mkdir(assembly);
      fresh = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if ((await fs.lstat(assembly)).isSymbolicLink())
      throw new Error('Repository assembly is a link');
    const leases = path.join(assembly, '.leases');
    await fs.mkdir(leases, { recursive: true });
    if ((await fs.lstat(leases)).isSymbolicLink()) throw new Error('Repository leases are a link');
    lease = path.join(leases, randomUUID() + '.json');
    await fs.writeFile(lease, JSON.stringify({ host: os.hostname(), pid: process.pid }), {
      flag: 'wx',
    });
    try {
      let owned = fresh;
      if (!owned) {
        try {
          const marker = await json(path.join(assembly, '.assembly.json'));
          owned =
            marker.schemaVersion === 1 &&
            marker.identity === identity &&
            Number.isFinite(marker.accessed);
        } catch {
          /* Existing unmarked or ambiguous assemblies remain unmanaged. */
        }
      }
      if (owned) {
        const next = path.join(assembly, '.assembly-' + randomUUID());
        await fs.writeFile(
          next,
          JSON.stringify({ schemaVersion: 1, identity, accessed: Date.now() }),
          { flag: 'wx' },
        );
        await fs.rename(next, path.join(assembly, '.assembly.json'));
      }
      await prune(root, {
        keep: new Set([identity]),
        reservation: { identity, bytes: expectedBytes },
      });
    } catch (error) {
      await fs.rm(lease, { force: true });
      throw error;
    }
  });
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await fs.rm(lease, { force: true });
    },
  };
}
