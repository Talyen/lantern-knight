import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import {
  leaseRepositoryAssembly,
  cleanRepositoryAssemblies,
} from '../../tools/assets/repository-cache';

test('assembly cleanup previews removal, protects independent leases and reconstructible current data', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-assembly-retention-');
  const id = 'a'.repeat(64),
    current = 'b'.repeat(64);
  const target = path.join(root, '.cache/repository-assets', id);
  const first = await leaseRepositoryAssembly(root, id, 100);
  const second = await leaseRepositoryAssembly(root, id, 100);
  await fs.writeFile(path.join(target, 'payload'), 'retained bytes');
  const policy = { keep: new Set([current]), all: true };
  assert.equal((await cleanRepositoryAssemblies(root, policy)).removed.length, 0);
  await first.release();
  assert.equal((await cleanRepositoryAssemblies(root, policy)).removed.length, 0);
  await second.release();
  const preview = await cleanRepositoryAssemblies(root, { ...policy, dryRun: true });
  assert.deepEqual(
    preview.removed.map((entry) => entry.identity),
    [id],
  );
  assert.equal(await fs.readFile(path.join(target, 'payload'), 'utf8'), 'retained bytes');
  await cleanRepositoryAssemblies(root, { keep: new Set([id]), all: true });
  assert.equal(await fs.readFile(path.join(target, 'payload'), 'utf8'), 'retained bytes');
  await cleanRepositoryAssemblies(root, policy);
  await assert.rejects(fs.access(target), /ENOENT/);
});

test('automatic retention accounts for incoming residency and preserves unknown or corrupt ownership', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-assembly-budget-');
  const old = 'c'.repeat(64),
    incoming = 'd'.repeat(64),
    unknown = 'e'.repeat(64);
  const base = path.join(root, '.cache/repository-assets');
  const first = await leaseRepositoryAssembly(root, old, 100);
  await fs.writeFile(path.join(base, old, 'payload'), Buffer.alloc(1024));
  await first.release();
  await fs.mkdir(path.join(base, unknown));
  await fs.writeFile(path.join(base, unknown, 'evidence'), 'preserve');
  // Opening an unmarked old assembly must not grant cleanup ownership of it.
  const unmanaged = await leaseRepositoryAssembly(root, unknown, 100);
  await unmanaged.release();
  const policy = {
    keep: new Set([incoming]),
    budgetBytes: 1200,
    reservation: { identity: incoming, bytes: 1100 },
  };
  assert.deepEqual(
    (await cleanRepositoryAssemblies(root, policy)).removed.map((entry) => entry.identity),
    [old],
  );
  assert.equal(await fs.readFile(path.join(base, unknown, 'evidence'), 'utf8'), 'preserve');
  const held = await leaseRepositoryAssembly(root, incoming, 100);
  await held.release();
  await fs.writeFile(path.join(base, incoming, '.leases/unknown.json'), '{');
  assert.equal(
    (await cleanRepositoryAssemblies(root, { keep: new Set(), all: true })).removed.length,
    0,
  );
});

test('cleanup cannot follow a linked cache outside the checkout', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-linked-cache-');
  const other = await temporaryDirectory(t, 'lantern-preserved-cache-');
  await fs.mkdir(path.join(root, '.cache'));
  await fs.writeFile(path.join(other, 'evidence'), 'preserve');
  await fs.symlink(other, path.join(root, '.cache/repository-assets'));
  await assert.rejects(
    cleanRepositoryAssemblies(root, { keep: new Set(), all: true }),
    /symbolic link/,
  );
  assert.equal(await fs.readFile(path.join(other, 'evidence'), 'utf8'), 'preserve');
});
