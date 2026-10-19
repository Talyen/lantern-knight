import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetReviewStore, AssetReviewConflict } from '../../tools/scene/asset-review-store';
import { assetReviewSchema } from '../../src/editor/asset-review-data';
import { reviewSceneAssets } from '../../src/editor/asset-review-model';
import { sceneFixture } from '../fixtures/scene';
import { execFileSync } from 'node:child_process';
import { checkpointSceneSaves } from '../../tools/scene/checkpoint-scene-saves';
import { defaultCampfireAsset } from '../../src/content/campfire-visuals';
import { manifestFixture } from '../fixtures/manifest';

test('review queue persists scoped decisions, rejects stale writers and recovers after failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-review-'));
  const file = path.join(root, 'asset-reviews.json');
  try {
    const store = new AssetReviewStore(file);
    assert.deepEqual(await store.read(), { reviews: { version: 1, entries: [] }, revision: null });
    const entry = { asset: 'ink-scenery', scene: 'orchard', notes: 'Too ornate' };
    const first = await store.save(
      { version: 1, entries: [entry, { ...entry, scene: null }] },
      null,
    );
    assert.deepEqual(await new AssetReviewStore(file).read(), first);
    const attempts = await Promise.allSettled([
      store.save({ version: 1, entries: [entry] }, first.revision),
      store.save({ version: 1, entries: [] }, first.revision),
    ]);
    assert.equal(attempts[0]!.status, 'fulfilled');
    assert.equal(attempts[1]!.status, 'rejected');
    assert.ok((attempts[1] as PromiseRejectedResult).reason instanceof AssetReviewConflict);
    assert.deepEqual((await store.read()).reviews.entries, [entry]);
    const current = await store.read();
    const cleared = await store.save({ version: 1, entries: [] }, current.revision);
    assert.deepEqual(cleared.reviews.entries, []);
    await fs.writeFile(file, 'unreadable');
    await assert.rejects(store.save({ version: 1, entries: [] }, cleared.revision));
    assert.equal(await fs.readFile(file, 'utf8'), 'unreadable');
    assert.throws(() => assetReviewSchema.parse({ version: 1, entries: [entry, entry] }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('review inventory deduplicates assets and includes ground, actors, fixture effects and transitive dependencies', () => {
  const scene = sceneFixture('graveyard');
  scene.objects.push({ ...scene.objects[0]!, id: 'second-tomb', x: 3, z: 3 });
  scene.objects[0]!.fixture = {
    id: 'review-lamp',
    socket: [0, 1, 0],
    power: 1,
    range: 3,
    phase: 0,
    smoke: false,
    embersScale: 1,
    flame: {
      asset: 'fx-flame',
      clip: 'show',
      scale: 1,
      offset: [0, 0, 0],
      phase: 0,
      depthOffset: 0,
      decorative: true,
    },
  };
  const manifest = (id: string, dependencies: string[]) => {
    const base = manifestFixture(id);
    return { ...base, asset: { ...base.asset, dependencies } };
  };
  const manifests = new Map([
    ['ink-scenery', manifest('ink-scenery', ['review-dependency'])],
    ['review-dependency', manifest('review-dependency', ['review-leaf'])],
  ]);
  scene.gameplay!.spawns.push({ id: 'review-enemy', actor: 'skeleton', x: 4, z: 4 });
  const usages = reviewSceneAssets(scene, manifests);
  assert.deepEqual(usages.get('ink-moss')!.roles, ['Ground']);
  assert.deepEqual(usages.get('ink-scenery')!.objects, ['family-tomb-west', 'second-tomb']);
  assert.equal(usages.get('ink-scenery')!.points.length, 2);
  assert.deepEqual(usages.get('ink-scenery')!.clips, ['tomb']);
  assert.ok([...usages.values()].some((u) => u.roles.includes('Enemy')));
  assert.deepEqual(usages.get('fx-flame')!.roles, ['Fixture effect']);
  assert.deepEqual(usages.get('review-leaf')!.roles, ['Dependency']);
  assert.ok([...usages.values()].some((u) => u.roles.includes('Hero')));
  assert.deepEqual(scene.objects[0]!.asset, 'ink-scenery');
});

test('valid review decisions checkpoint for future tasks while invalid edits remain untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-review-checkpoint-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.test');
    git('commit', '--allow-empty', '-m', 'base');
    await fs.mkdir(path.join(root, 'authoring'));
    const file = path.join(root, 'authoring/asset-reviews.json');
    const bytes =
      JSON.stringify({
        version: 1,
        entries: [{ asset: 'ink-scenery', scene: null, notes: 'Replace this set' }],
      }) + '\n';
    await fs.writeFile(file, bytes);
    await checkpointSceneSaves(root);
    assert.equal(git('show', 'HEAD:authoring/asset-reviews.json'), bytes);
    assert.equal(git('status', '--porcelain'), '');
    await fs.writeFile(file, '{"invalid":true}');
    await assert.rejects(checkpointSceneSaves(root));
    assert.equal(await fs.readFile(file, 'utf8'), '{"invalid":true}');
    assert.equal(git('diff', '--cached'), '');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('review focus resolves mounted scenery and generated campfires without selecting synthetic objects', () => {
  const scene = sceneFixture('chapel');
  scene.gameplay!.campfires = [{ id: 'rest', name: 'Rest', x: 3, z: 4, safeRadius: 2 }];
  const usages = reviewSceneAssets(scene, new Map());
  assert.deepEqual(usages.get('ink-crypt')!.points, [{ x: -0.07, z: -6.95 + 0.08 }]);
  assert.deepEqual(usages.get('ink-crypt')!.objects, ['crypt-altar-candles']);
  const fire = usages.get(defaultCampfireAsset)!;
  assert.deepEqual(fire.roles, ['Scenery']);
  assert.deepEqual(fire.points, [{ x: 3, z: 4 }]);
  assert.deepEqual(fire.clips, ['loop']);
  assert.deepEqual(fire.objects, []);
});
