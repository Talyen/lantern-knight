import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AssetCache } from '../../tools/assets/cache';
import { temporaryDirectory } from '../fixtures/temporary-directory';

test(
  'cache readers wait through a live accounting operation instead of restarting work',
  { timeout: 15_000 },
  async (t) => {
    const root = await temporaryDirectory(t, 'lantern-cache-contention-');
    const cache = new AssetCache(root, 1024 * 1024);
    await cache.initialize();
    const mutex = path.join(root, '.mutex');
    await fs.mkdir(mutex);
    await fs.writeFile(
      path.join(mutex, 'owner.json'),
      JSON.stringify({ pid: process.pid, host: os.hostname() }),
    );
    t.after(() => fs.rm(mutex, { recursive: true, force: true }));
    const admission = cache.lease('reader').then(
      (held) => ({ held }),
      (error: unknown) => ({ error }),
    );
    await delay(1_000);
    await fs.rm(mutex, { recursive: true });
    const outcome = await admission;
    if ('error' in outcome) throw outcome.error;
    try {
      assert.ok((await fs.readdir(path.join(outcome.held.root, '.leases'))).length > 0);
    } finally {
      await outcome.held.release();
    }
    assert.deepEqual(await fs.readdir(path.join(outcome.held.root, '.leases')), []);
  },
);
