import { emptyScene } from '../../src/editor/default-scene';
import { sceneFixture } from '../fixtures/scene';
import { applySceneryPreset, sceneFixtures } from '../../src/content/scenery-presets';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSceneDocument, validateSceneReferences } from '../../src/content/scene-document';
import {
  churchyardColliders,
  resolveAuthoredScene,
  resolveScene,
} from '../../src/content/world-art';
import { EditorHistory } from '../../src/editor/model';
import { SceneStore } from '../../tools/scene/scene-editor-store';
describe('scene authoring contracts', () => {
  it('derives collision footprints and rejects invalid edits without changing history', () => {
    const h = new EditorHistory(sceneFixture('graveyard')),
      before = structuredClone(h.document);
    assert.throws(() => h.transform('family-tomb-west', { y: NaN }));
    assert.throws(() => h.transform('boundary-oak', { scale: 0 }));
    assert.deepEqual(h.document, before);
    assert.equal(h.canUndo, false);
    h.transform('family-tomb-west', { x: -6.3 });
    h.undo();
    assert.deepEqual(h.document, before);
    h.redo();
    const art = resolveAuthoredScene(h.document),
      p = art.props.find((p) => p.id === 'family-tomb-west')!;
    assert.deepEqual(churchyardColliders(art).find((v) => v.id === p.id)!.size, p.footprint);
    const duplicate = h.duplicate('family-tomb-west');
    h.remove(duplicate);
    h.remove('family-tomb-west');
    h.undo();
    assert.equal(h.document.objects.find((p) => p.id === 'family-tomb-west')!.x, -6.3);
  });
  it('resolves edited geometry, collision and asset requirements together', () => {
    const document = sceneFixture('graveyard');
    document.geometry!.bounds.maxX += 1;
    const item = document.objects.find((p) => p.id === 'family-tomb-west')!;
    item.footprint = [0.95, 2.25];
    item.x = (item.x ?? 0) + 0.1;
    const resolved = resolveScene(document);
    assert.equal(resolved.area.bounds.maxX, document.geometry!.bounds.maxX);
    assert.equal(resolved.area.props.find((p) => p.id === item.id)!.x, item.x);
    assert.ok(resolved.assets.includes(item.asset));
    assert.equal(resolved.visuals.props.find((p) => p.id === item.id)!.x, item.x);
  });
  it('rejects unsupported documents and references without silently resetting them', () => {
    assert.throws(() => parseSceneDocument({ ...emptyScene(), version: 99 }));
    assert.throws(() => parseSceneDocument({ ...emptyScene(), id: '../outside' }));
    const d = emptyScene();
    d.objects.push({ id: 'tree', kind: 'prop', asset: 'missing', clip: 'oak', x: 0, z: 0 });
    assert.throws(() => validateSceneReferences(d, new Map()), /Unavailable/);
    d.objects.push({ ...d.objects[0]! });
    assert.throws(() => parseSceneDocument(d), /Duplicate/);
  });
  it('preserves undo/redo across saving a production copy as a draft', () => {
    const h = new EditorHistory(sceneFixture('graveyard'));
    h.transform('family-tomb-west', { x: -6.2 });
    h.transform('family-tomb-west', { x: -6.3 });
    h.undo();
    h.reidentify('scene-copy', 'draft');
    h.redo();
    assert.equal(h.document.objects.find((p) => p.id === 'family-tomb-west')!.x, -6.3);
    h.undo();
    h.undo();
    assert.equal(h.document.id, 'scene-copy');
    assert.equal(h.document.target, 'draft');
    const before = structuredClone(h.document);
    assert.throws(() => h.reidentify('../outside', 'draft'));
    assert.deepEqual(h.document, before);
    assert.equal(h.canRedo, true);
  });
});
describe('scene file saving', () => {
  it('round-trips, rejects simultaneous writes, and preserves malformed external files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-editor-'));
    try {
      const store = new SceneStore(directory),
        d = { ...emptyScene(), id: 'forest' };
      const first = await store.save(d, null);
      assert.deepEqual((await store.read('forest')).document, d);
      const results = await Promise.allSettled([
        store.save({ ...d, name: 'A' }, first.revision),
        store.save({ ...d, name: 'B' }, first.revision),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        ['fulfilled', 'rejected'],
      );
      assert.equal((await store.read('forest')).document!.name, 'A');
      await fs.writeFile(path.join(directory, 'forest.json'), 'newer or malformed agent output');
      await assert.rejects(store.save(d, first.revision), /changed on disk/);
      assert.equal(
        await fs.readFile(path.join(directory, 'forest.json'), 'utf8'),
        'newer or malformed agent output',
      );
      await assert.rejects(store.read('../forest'), /identity/);
      await fs.symlink(path.join(directory, 'forest.json'), path.join(directory, 'link.json'));
      await assert.rejects(store.save({ ...d, id: 'link' }, null), /regular file/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('leaves existing bytes intact when validation fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-editor-'));
    try {
      const d = { ...emptyScene(), id: 'forest' },
        store = new SceneStore(directory),
        first = await store.save(d, null),
        bytes = await fs.readFile(path.join(directory, 'forest.json'), 'utf8');
      const rejecting = new SceneStore(directory, async () => {
        throw new Error('Unavailable ground material');
      });
      await assert.rejects(rejecting.save(d, first.revision), /Unavailable/);
      assert.equal(await fs.readFile(path.join(directory, 'forest.json'), 'utf8'), bytes);
      assert.deepEqual(await fs.readdir(directory), ['forest.json']);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

it('obsolete drafts reject and mounted lamps follow edited supports through cascading undo', () => {
  assert.throws(() => parseSceneDocument({ ...sceneFixture('graveyard'), version: 2 }), /5/);
  const h = new EditorHistory(sceneFixture('chapel'));
  const lamp = () =>
    resolveAuthoredScene(h.document).props.find((p) => p.id === 'crypt-altar-candles')!;

  h.transform('crypt-altar', { x: 1, z: -6.5 });
  assert.ok(Math.abs(lamp().x - 0.93) < 1e-10);
  assert.equal(lamp().y, 1.15);
  const copy = h.duplicate('crypt-altar-candles');
  h.remove(copy);
  h.remove('crypt-altar');
  assert.ok(!h.document.objects.some((p) => p.mount?.to === 'crypt-altar'));
  h.undo();
  assert.ok(Math.abs(lamp().x - 0.93) < 1e-10);
});
it('attachment cycles and missing supports reject without changing history', () => {
  const h = new EditorHistory(sceneFixture('chapel')),
    before = structuredClone(h.document);
  assert.throws(
    () =>
      h.change((d) => {
        d.objects.find((p) => p.id === 'crypt-altar-candles')!.mount!.to = 'missing';
      }),
    /Missing attachment/,
  );
  assert.throws(
    () =>
      h.change((d) => {
        d.objects.find((p) => p.id === 'crypt-altar-candles')!.mount!.to = 'crypt-altar-candles';
      }),
    /Cyclic/,
  );
  assert.deepEqual(h.document, before);
  assert.equal(h.canUndo, false);
  {
    const h = new EditorHistory(emptyScene());
    const template = { asset: 'ink-graveyard-scenery', clip: 'lantern-hardware' };
    for (let i = 0; i < 3; i++)
      h.change((d) =>
        d.objects.push(
          applySceneryPreset({
            id: 'lamp-' + i,
            kind: 'prop',
            asset: template.asset,
            clip: template.clip,
            x: i,
            z: 0,
          }),
        ),
      );
    const art = resolveAuthoredScene(h.document);

    assert.ok(art.proceduralAssets.includes('ink-ambient'));
    h.transform('lamp-0', { x: 2 });
    const before = structuredClone(h.document);
    assert.throws(
      () =>
        h.change((d) =>
          d.objects.push(
            applySceneryPreset({
              id: 'fourth-lamp',
              kind: 'prop',
              asset: template.asset,
              clip: template.clip,
              x: 0,
              z: 0,
            }),
          ),
        ),
      /three lights/,
    );
    assert.deepEqual(h.document, before);
  }
});

it('prototype support scale/mirroring preserves finite attachment transforms', () => {
  const h = new EditorHistory(sceneFixture('chapel')),
    before = structuredClone(h.document);
  h.transform('chapel-devotional-table', { scale: 1.5, mirror: true });
  assert.notDeepEqual(h.document, before);
  for (const f of sceneFixtures(resolveAuthoredScene(h.document)))
    assert.ok(f.socket.every(Number.isFinite));
});
