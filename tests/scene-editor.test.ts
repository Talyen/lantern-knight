import { applySceneryPreset, sceneFixtures } from '../src/content/scenery-presets';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  emptyScene,
  parseSceneDocument,
  resolveSceneDocument,
  validateSceneReferences,
} from '../src/content/scene-document';
import {
  baseWorldVisuals,
  worldVisuals,
  churchyardColliders,
  resolveAuthoredScene,
} from '../src/content/world-art';
import { EditorHistory } from '../src/editor/model';
import { SceneStore } from '../tools/scene-editor-store';
describe('scene authoring contracts', () => {
  it('keeps locked structures and metadata while applying reversible placements', () => {
    const base = baseWorldVisuals.court!,
      original = structuredClone(base),
      d = emptyScene('court'),
      p = worldVisuals.court!.props.find((p) => p.id === 'family-tomb-west')!;
    Object.assign(
      d.objects.find((v) => v.id === p.id)!,
      { x: p.x + 1, scale: 1.2 },
    );
    const art = resolveSceneDocument(d, base);
    assert.deepEqual(
      art.props.find((v) => v.id === p.id),
      { ...p, x: p.x + 1, scale: 1.2 },
    );
    assert.equal(art.walls, base.walls);
    assert.equal(art.paths, base.paths);
    assert.deepEqual(base, original);
    d.objects.push({
      id: base.walls[0]!.id,
      kind: 'prop',
      asset: 'ink-scenery',
      clip: 'doorway',
      x: 0,
      z: 0,
    });
    assert.throws(() => resolveSceneDocument(d, base), /Locked/);
    assert.equal(
      churchyardColliders('court', art).find((p) => p.id === 'family-tomb-west')!.x,
      p.x + 1,
    );
    assert.deepEqual(
      churchyardColliders('court', art).find((v) => v.id === p.id)!.size,
      p.footprint,
    );
  });
  it('preserves deletion and transforms through undo and gives duplicates no collision footprint', () => {
    const h = new EditorHistory(emptyScene('court'));
    h.transform('family-tomb-west', { x: 2, mirror: true });
    const duplicate = h.duplicate('family-tomb-west');
    assert.equal(
      resolveAuthoredScene(h.document).props.find((p) => p.id === duplicate)!.tint,
      worldVisuals.court!.props.find((p) => p.id === 'family-tomb-west')!.tint,
    );
    const oak = h.duplicate('boundary-oak');
    assert.equal(resolveAuthoredScene(h.document).props.find((p) => p.id === oak)!.fade, true);
    h.remove('family-tomb-west');
    let art = resolveSceneDocument(h.document, baseWorldVisuals.court);
    assert.equal(
      art.props.some((p) => p.id === 'family-tomb-west'),
      false,
    );
    assert.equal(art.props.find((p) => p.id === duplicate)?.footprint, undefined);
    h.undo();
    art = resolveSceneDocument(h.document, baseWorldVisuals.court);
    assert.equal(art.props.find((p) => p.id === 'family-tomb-west')!.x, 2);
    assert.equal(art.props.find((p) => p.id === 'family-tomb-west')!.mirror, true);
    h.redo();
    assert.equal(
      resolveSceneDocument(h.document, baseWorldVisuals.court).props.some(
        (p) => p.id === 'family-tomb-west',
      ),
      false,
    );
  });

  it('rejects unsupported documents and assets without silently resetting them', () => {
    assert.throws(() => parseSceneDocument({ ...emptyScene(), version: 99 }));
    assert.throws(() => parseSceneDocument({ ...emptyScene(), id: '../outside' }));
    assert.throws(() => parseSceneDocument({ ...emptyScene(), target: 'live' }));
    const d = emptyScene();
    d.objects.push(
      applySceneryPreset({ id: 'tree', kind: 'prop', asset: 'missing', clip: 'oak', x: 0, z: 0 }),
    );
    assert.throws(() => validateSceneReferences(d, undefined, new Map()), /Unavailable/);
    d.objects.push({ ...d.objects[0]! });
    assert.throws(() => parseSceneDocument(d), /Duplicate/);
  });
  it('preserves undo and redo across saving a copy without reverting to its source identity', () => {
    const h = new EditorHistory({ ...emptyScene('court'), id: 'live-court', target: 'live' });
    h.transform('family-tomb-west', { x: 2 });
    h.transform('family-tomb-west', { x: 3 });
    h.undo();
    h.reidentify('scene-copy', 'draft');
    assert.equal(h.document.id, 'scene-copy');
    assert.equal(h.document.target, 'draft');
    h.redo();
    assert.equal(
      resolveAuthoredScene(h.document).props.find((p) => p.id === 'family-tomb-west')!.x,
      3,
    );
    h.undo();
    h.undo();
    assert.equal(h.document.id, 'scene-copy');
    assert.equal(h.document.target, 'draft');
    assert.equal(
      h.document.objects.find((p) => p.id === 'family-tomb-west')!.x,
      worldVisuals.court!.props.find((p) => p.id === 'family-tomb-west')!.x,
    );
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

it('migrates version 1 overrides once and keeps independent complete draft scenery', () => {
  const current = emptyScene('court');
  const { objects: _, version: __, ...fields } = current;
  const old = {
    ...fields,
    version: 1,
    changes: [
      { id: 'family-tomb-west', x: 2, z: 1 },
      { id: 'boundary-oak', x: 0, z: 0, deleted: true },
    ],
    objects: [
      { id: 'new-decoration', kind: 'prop', asset: 'ink-scenery', clip: 'tomb', x: 0, z: 0 },
    ],
  };
  const migrated = parseSceneDocument(old),
    art = resolveAuthoredScene(migrated);
  assert.equal(art.props.find((p) => p.id === 'family-tomb-west')!.x, 2);
  assert.equal(art.props.find((p) => p.id === 'family-tomb-west')!.footprint![0], 0.85);
  assert.ok(!art.props.some((p) => p.id === 'boundary-oak'));
  assert.equal(art.props.find((p) => p.id === 'new-decoration')!.footprint, undefined);
  assert.deepEqual(parseSceneDocument(migrated), migrated);
  assert.equal(migrated.objects.filter((p) => p.id === 'new-decoration').length, 1);
  assert.equal(current.objects.find((p) => p.id === 'family-tomb-west')!.x, -5.95);
  assert.throws(
    () => parseSceneDocument({ ...old, changes: [{ id: 'gate-lamp', x: 0, z: 0 }] }),
    /Locked/,
  );
});
it('mounted lamp edits follow supports, duplicate without colliders, and undo cascading deletion', () => {
  const h = new EditorHistory(emptyScene('upper-landing'));
  const lamp = () =>
    resolveAuthoredScene(h.document).props.find((p) => p.id === 'crypt-altar-candles')!;
  h.transform('crypt-altar-candles', { x: 0.4, y: 1.3, scale: 1.2, mirror: true });
  assert.equal(h.document.objects.find((p) => p.id === 'crypt-altar-candles')!.x, undefined);
  h.transform('crypt-altar', { x: 1, z: -6 });
  assert.equal(lamp().x, 1.4);
  assert.equal(lamp().y, 1.3);
  assert.ok(Math.abs(lamp().z - -5.92) < 1e-8);
  const before = structuredClone(h.document);
  assert.throws(() => h.duplicate('crypt-altar-candles'), /three lights/);
  assert.deepEqual(h.document, before);
  h.remove('crypt-entry-lamp');
  const duplicate = h.duplicate('crypt-altar-candles'),
    copy = resolveAuthoredScene(h.document).props.find((p) => p.id === duplicate)!;
  assert.equal(copy.mount!.to, 'crypt-altar');
  assert.equal(copy.x, 1.9);
  assert.equal(copy.footprint, undefined);
  assert.notEqual(copy.fixture!.id, lamp().fixture!.id);
  h.remove('crypt-altar');
  assert.ok(!h.document.objects.some((p) => p.mount?.to === 'crypt-altar'));
  h.undo();
  assert.equal(lamp().x, 1.4);
  assert.ok(h.document.objects.some((p) => p.id === duplicate));
});
it('attachment cycles and missing supports reject without changing history', () => {
  const h = new EditorHistory(emptyScene('upper-landing')),
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
    const template = worldVisuals.court!.props.find((p) => p.clip === 'lantern-hardware')!;
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

it('support scale and mirroring carry mounted lamps while inspector edits remain in world coordinates', () => {
  const h = new EditorHistory(emptyScene('upper-landing'));
  const lamp = () =>
    resolveAuthoredScene(h.document).props.find((p) => p.id === 'chapel-devotional-candles')!;
  const before = { ...lamp() };
  h.transform('chapel-devotional-table', { scale: 1.5, mirror: true });
  const support = resolveAuthoredScene(h.document).props.find(
    (p) => p.id === 'chapel-devotional-table',
  )!;
  assert.ok(Math.abs(lamp().x - (support.x + 0.16)) < 1e-10);
  assert.ok(Math.abs(lamp().z - (support.z - 0.14)) < 1e-10);
  assert.ok(Math.abs(lamp().y! - 0.92) < 1e-10);
  h.transform('chapel-devotional-candles', { x: -4, y: 1.2 });
  assert.ok(Math.abs(lamp().x + 4) < 1e-10);
  assert.ok(Math.abs(lamp().y! - 1.2) < 1e-10);
  h.remove('crypt-entry-lamp');
  const copy = h.duplicate('chapel-devotional-candles'),
    duplicated = resolveAuthoredScene(h.document).props.find((p) => p.id === copy)!;
  assert.ok(Math.abs(duplicated.x - lamp().x - 0.5) < 1e-10);
  h.undo();
  h.undo();
  h.undo();
  h.undo();
  assert.deepEqual(lamp(), before);
  const resolved = resolveAuthoredScene(h.document);
  for (const fixture of sceneFixtures(resolved)) {
    const prop = resolved.props.find((prop) => prop.id === fixture.prop)!;
    const socket = prop.fixture!.socket;
    const expected = (prop.mirror ? [socket[2], socket[1], socket[0]] : socket).map(
      (value) => value! * (prop.scale ?? 1),
    );
    assert.deepEqual(fixture.socket, expected);
  }
});
