import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { snapshot, delta, phaseEvidence } from '../tools/task-state';
import { cachedPreparationStep } from '../tools/assets/incremental';
import { makeArchive, validatePack } from '../tools/assets/pack';
import { prepareBundles, ensureBundlePack } from '../tools/assets/bundles';
import { AssetCache } from '../tools/assets/cache';
import { reusableDeliveryPhase } from '../tools/phase-run';
import {
  preparationSteps,
  preparationSelection,
  preparationStepKey,
  recipeInputs,
} from '../tools/assets/recipe';

test('cold task evidence initializes cache ownership before writing report directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-cold-cache-'));
  const previous = process.env.LANTERN_CACHE_ROOT;
  const cacheRoot = path.join(root, 'cache');
  process.env.LANTERN_CACHE_ROOT = cacheRoot;
  try {
    await phaseEvidence(root, 'cold-start', 'one', async () => ({ passed: true }));
    const marker = JSON.parse(await fs.readFile(path.join(cacheRoot, '.cache-owner.json'), 'utf8'));
    assert.equal(marker.project, 'lantern-knight');
    const held = await new AssetCache(cacheRoot).lease('subsequent-command');
    await held.release();
  } finally {
    if (previous === undefined) delete process.env.LANTERN_CACHE_ROOT;
    else process.env.LANTERN_CACHE_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('preparation reuse invalidates registration, source-index and lighting-owner changes without rebaking media', async () => {
  const inputs = await recipeInputs(),
    digests = new Map<string, string>();
  const step = (file: string) => preparationSteps.find((step) => step.file === file)!;
  for (const [file, input] of [
    ['prepare-ink.ts', 'src/content/scenery-registration.ts'],
    ['prepare-hero.ts', 'src/content/hero-actions.ts'],
    ['prepare-lighting.ts', 'tools/lighting-bindings.ts'],
    ['prepare-graveyard-coverage.ts', 'tools/assets/authoring-catalog.ts'],
    ['prepare-surface-relief.ts', 'src/content/asset-catalog.ts'],
    ['prepare-library.ts', 'assets/library-sources.json'],
    ['prepare-ink.ts', 'assets/sources.json'],
  ]) {
    const changed = { ...inputs, [input!]: 'changed' };
    assert.notEqual(
      preparationStepKey(step(file!), inputs, digests),
      preparationStepKey(step(file!), changed, digests),
      input,
    );
    assert.equal(
      preparationStepKey(step('prepare-loading-media.ts'), inputs, digests),
      preparationStepKey(step('prepare-loading-media.ts'), changed, digests),
    );
  }
});

test('full and scoped preparation run producers before consumers, including flat-stage relief inputs', () => {
  for (const steps of [preparationSteps, preparationSelection(['surface-relief'])]) {
    const completed = new Set<string>();
    for (const step of steps) {
      for (const dependency of step.dependsOn ?? [])
        assert.ok(completed.has(dependency), `${step.file} ran before ${dependency}`);
      completed.add(step.file);
    }
    assert.ok(completed.has('prepare-flat-stage.ts'));
    assert.ok(completed.has('prepare-surface-relief.ts'));
  }
});

test('prototype snapshots retain dirty baseline and detect additions, edits and deletions without reading bulk data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-inputs-'));
  try {
    await fs.mkdir(path.join(root, 'src'));
    await fs.writeFile(path.join(root, 'src/value.ts'), 'export const value = 1;');
    const before = await snapshot(root);
    await fs.writeFile(path.join(root, 'src/value.ts'), 'export const value = 2;');
    await fs.writeFile(path.join(root, 'README.md'), 'new docs');
    const after = await snapshot(root);
    assert.deepEqual(delta(before, after), ['README.md', 'src/value.ts']);
    await fs.unlink(path.join(root, 'src/value.ts'));
    assert.ok(delta(after, await snapshot(root)).includes('src/value.ts'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('phase receipts reuse only successful matching executions and reject invalid outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-proof-'));
  try {
    let runs = 0;
    const run = async () => ({ generation: ++runs });
    assert.equal((await phaseEvidence(root, 'fixture', 'one', run)).reused, false);
    assert.equal((await phaseEvidence(root, 'fixture', 'one', run)).reused, true);
    assert.equal((await phaseEvidence(root, 'fixture', 'two', run)).reused, false);
    await assert.rejects(
      phaseEvidence(root, 'failure', 'one', async () => {
        throw new Error('cancelled');
      }),
      /cancelled/,
    );
    assert.equal((await phaseEvidence(root, 'failure', 'one', run)).reused, false);
    assert.equal(
      (await phaseEvidence(root, 'fixture', 'two', run, async () => false)).reused,
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('delivery phase reuse keeps unchanged captures but invalidates harness and package output changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-delivery-'));
  try {
    await fs.mkdir(path.join(root, 'tools'));
    await fs.mkdir(path.join(root, 'dist'));
    await fs.mkdir(path.join(root, 'captures'));
    await fs.writeFile(path.join(root, 'tools/check.ts'), 'export {};');
    await fs.writeFile(path.join(root, 'dist/app.asar'), 'package');
    let runs = 0;
    const options = {
      name: 'fixture',
      entry: 'tools/check.ts',
      args: [],
      outputFiles: ['dist/app.asar'],
      run: async () => {
        runs++;
        await fs.writeFile(path.join(root, 'captures/frame.png'), 'pixels' + runs);
        return [path.join(root, 'captures')];
      },
    };
    await reusableDeliveryPhase(root, options);
    await fs.writeFile(path.join(root, 'dist/app.asar'), 'package');
    await reusableDeliveryPhase(root, options);
    assert.equal(runs, 1);
    await fs.writeFile(path.join(root, 'tools/check.ts'), 'export const changed = true;');
    await reusableDeliveryPhase(root, options);
    assert.equal(runs, 2);
    await fs.writeFile(path.join(root, 'dist/app.asar'), 'changed package');
    await reusableDeliveryPhase(root, options);
    assert.equal(runs, 3);
    await fs.unlink(path.join(root, 'captures/frame.png'));
    await reusableDeliveryPhase(root, options);
    assert.equal(runs, 4);
    await assert.rejects(
      reusableDeliveryPhase(root, {
        ...options,
        name: 'unstable-package',
        run: async () => {
          await fs.writeFile(path.join(root, 'dist/app.asar'), 'modified during check');
          return [];
        },
      }),
      /package outputs changed/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('incremental preparation reuses one validated step and rebuilds changed inputs or corrupt outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-step-'));
  const workspace = path.join(root, 'work'),
    cache = path.join(root, 'steps');
  await fs.mkdir(workspace);
  let runs = 0,
    checks = 0;
  const run = async (env: NodeJS.ProcessEnv) => {
    runs++;
    await fs.mkdir(path.join(workspace, 'public/media'), { recursive: true });
    await fs.rm(path.join(workspace, 'public/media/sample.mp4'), { force: true });
    await fs.writeFile(path.join(workspace, 'public/media/sample.mp4'), 'native source ' + runs);
    await fs.writeFile(env.LANTERN_STEP_OUTPUT_LOG!, 'public/media/sample.mp4\n');
  };
  try {
    const options = {
      file: 'prepare-sample.ts',
      workspace,
      cache,
      key: 'one',
      run,
      validate: async () => {
        checks++;
      },
    };
    assert.equal((await cachedPreparationStep(options)).reused, false);
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(workspace);
    assert.equal((await cachedPreparationStep(options)).reused, true);
    assert.equal(runs, 1);
    assert.equal(checks, 1);
    assert.equal((await cachedPreparationStep({ ...options, key: 'two' })).reused, false);
    await fs.writeFile(path.join(cache, 'prepare-sample/files/public/media/sample.mp4'), 'corrupt');
    assert.equal((await cachedPreparationStep({ ...options, key: 'two' })).reused, false);
    assert.equal(runs, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('bundled pins round-trip offline and a media edit reuses every unchanged content bundle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-bundles-'));
  try {
    const payload = path.join(root, 'payload');
    await fs.mkdir(path.join(payload, 'public/media'), { recursive: true });
    await fs.mkdir(path.join(payload, 'metadata'));
    await fs.writeFile(path.join(payload, 'public/media/demo.mp4'), 'native clip');
    await fs.writeFile(path.join(payload, 'public/config.json'), '{}');
    await fs.writeFile(path.join(payload, 'metadata/receipt.json'), '{}');
    const archive = path.join(root, 'archive.tar.gz');
    const lock = await makeArchive(payload, archive, 'a'.repeat(64));
    const candidate = { payload, archive, lock, held: { root } } as unknown as Parameters<
      typeof prepareBundles
    >[0];
    const first = await prepareBundles(candidate);
    const bodies = new Map<string, Buffer>();
    for (const [name, file] of Object.entries(first.archives))
      bodies.set(first.pin.bundles[name]!.releaseTag, await fs.readFile(file));
    const cache = new AssetCache(path.join(root, 'cache'), 64 * 1024 ** 2);
    const held = await ensureBundlePack(first.pin, cache, (async (url) => {
      const address = url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      const tag = new URL(address).pathname.split('/').at(-2)!;
      return new Response(new Uint8Array(bodies.get(tag)!));
    }) as typeof fetch);
    await validatePack(held.root, first.pin);
    await held.release();
    const offline = await ensureBundlePack(first.pin, cache, async () => {
      throw new Error('unexpected network');
    });
    await offline.release();
    await fs.writeFile(path.join(payload, 'public/media/demo.mp4'), 'different native clip');
    const nextLock = await makeArchive(payload, archive, 'a'.repeat(64));
    const second = await prepareBundles({ ...candidate, lock: nextLock }, first.pin);
    assert.deepEqual(Object.keys(second.archives), ['media-demo']);
    assert.deepEqual(second.pin.bundles.common, first.pin.bundles.common);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('bundle assembly rejects case collisions between independently valid archives', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prototype-bundle-collision-'));
  try {
    const payload = path.join(root, 'payload');
    await fs.mkdir(path.join(payload, 'public/media'), { recursive: true });
    await fs.mkdir(path.join(payload, 'public/Media'), { recursive: true });
    // On a case-insensitive host, test the collision through directory spelling
    // in the inventories instead of creating conflicting local source paths.
    const bodies = new Map<string, Buffer>();
    const pins: Record<string, Awaited<ReturnType<typeof makeArchive>>> = {};
    for (const [name, spelling] of [
      ['clip', 'media'],
      ['common', 'Media'],
    ]) {
      const part = path.join(root, name!);
      await fs.mkdir(path.join(part, 'public', spelling!), { recursive: true });
      await fs.mkdir(path.join(part, 'metadata'));
      await fs.writeFile(path.join(part, 'public', spelling!, 'demo.mp4'), 'clip');
      const archive = path.join(root, name! + '.tar.gz');
      const lock = await makeArchive(
        part,
        archive,
        name === 'clip' ? 'a'.repeat(64) : 'b'.repeat(64),
      );
      pins[name!] = lock;
      bodies.set(lock.releaseTag, await fs.readFile(archive));
    }
    const candidate = await makeArchive(
      payload,
      path.join(root, 'candidate.tar.gz'),
      'c'.repeat(64),
    );
    const { preparationPin } = await import('../tools/assets/pack');
    const pin = {
      ...preparationPin(candidate, {}, await validatePack(payload, candidate)),
      schemaVersion: 3 as const,
      bundles: pins,
    };
    await assert.rejects(
      ensureBundlePack(
        pin as Parameters<typeof ensureBundlePack>[0],
        new AssetCache(path.join(root, 'cache')),
        (async (url) => {
          const address = url instanceof Request ? url.url : url.toString();
          const tag = new URL(address).pathname.split('/').at(-2)!;
          return new Response(new Uint8Array(bodies.get(tag)!));
        }) as typeof fetch,
      ),
      /case-colliding/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
