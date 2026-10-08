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
      p = base.props.find((p) => p.id === 'family-tomb-west')!;
    d.changes = [{ id: p.id, x: p.x + 1, z: p.z, scale: 1.2 }];
    const art = resolveSceneDocument(d, base);
    assert.deepEqual(
      art.props.find((v) => v.id === p.id),
      { ...p, x: p.x + 1, scale: 1.2 },
    );
    assert.equal(art.walls, base.walls);
    assert.equal(art.paths, base.paths);
    assert.equal(art.fixtures, base.fixtures);
    assert.deepEqual(base, original);
    d.changes = [{ id: 'gate-lamp', x: 0, z: 0 }];
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
      baseWorldVisuals.court!.props.find((p) => p.id === 'family-tomb-west')!.tint,
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

  it('inherits lamp presets while keeping new decorations editable and enforcing light capacity transactionally', () => {
    const h = new EditorHistory(emptyScene());
    const template = baseWorldVisuals.court!.props.find((p) => p.clip === 'lantern-hardware')!;
    for (let i = 0; i < 3; i++)
      h.change((d) =>
        d.objects.push({
          id: 'lamp-' + i,
          kind: 'prop',
          asset: template.asset,
          clip: template.clip,
          x: i,
          z: 0,
        }),
      );
    const art = resolveAuthoredScene(h.document);
    assert.deepEqual(art.props[0]!.light, template.light);
    assert.ok(art.proceduralAssets.includes('ink-ambient'));
    h.transform('lamp-0', { x: 2 });
    const before = structuredClone(h.document);
    assert.throws(
      () =>
        h.change((d) =>
          d.objects.push({
            id: 'fourth-lamp',
            kind: 'prop',
            asset: template.asset,
            clip: template.clip,
            x: 0,
            z: 0,
          }),
        ),
      /three lights/,
    );
    assert.deepEqual(h.document, before);
  });
  it('rejects unsupported documents and assets without silently resetting them', () => {
    assert.throws(() => parseSceneDocument({ ...emptyScene(), version: 2 }));
    assert.throws(() => parseSceneDocument({ ...emptyScene(), id: '../outside' }));
    assert.throws(() => parseSceneDocument({ ...emptyScene(), target: 'live' }));
    const d = emptyScene();
    d.objects.push({ id: 'tree', kind: 'prop', asset: 'missing', clip: 'oak', x: 0, z: 0 });
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
    assert.equal(h.document.changes.length, 0);
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

it('lamp presets are explicit and resolved fixture sockets preserve scale and mirroring', async () => {
  const { sceneFixtures, sceneryPresets } = await import('../src/content/scenery-presets');
  const d = emptyScene();
  d.objects.push({
    id: 'lamp',
    kind: 'prop',
    asset: 'ink-graveyard-scenery',
    clip: 'lantern-hardware',
    x: 2,
    z: 3,
    scale: 2,
    mirror: true,
  });
  const art = resolveAuthoredScene(d),
    fixture = sceneFixtures(art)[0]!;
  assert.equal(fixture.prop, 'lamp');
  assert.equal(fixture.id, 'lamp-flame');
  assert.deepEqual(fixture.socket, [0.06, 0.44, -0.06]);
  assert.equal(
    fixture.power,
    sceneryPresets['ink-graveyard-scenery:lantern-hardware']!.light.power,
  );
  assert.equal(fixture.flame!.scale, 0.76);
  for (const base of Object.values(baseWorldVisuals)) {
    const resolved = sceneFixtures(base);
    for (const f of resolved) {
      const p = base.props.find((p) => p.id === f.prop)!;
      assert.deepEqual(
        f.socket,
        p.light!.offset.map((v) => v * (p.scale ?? 1)),
      );
    }
  }
});
