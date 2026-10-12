import { emptyScene } from '../../src/editor/default-scene';
import { sceneFixture } from '../fixtures/scene';
import { applySceneryPreset } from '../../src/content/scenery-presets';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseSceneDocument,
  validateSceneReferences,
  type SceneDocument,
} from '../../src/content/scene-document';
import {
  churchyardColliders,
  resolveAuthoredScene,
  resolveScene,
} from '../../src/content/world-art';
import { EditorHistory, sceneItems } from '../../src/editor/model';
import { EditorDocument } from '../../src/editor/document';
import { SceneStore } from '../../tools/scene/scene-editor-store';
describe('scene authoring contracts', () => {
  it('demands rain assets only when authored rain is enabled', () => {
    const document = emptyScene();
    document.weather = { rain: 0, wind: { x: 0, z: 0 } };
    assert.equal(resolveScene(document).assets.includes('fx-splash'), false);
    document.weather.rain = 0.2;
    const assets = resolveScene(document).assets;
    assert.ok(assets.includes('fx-splash'));
    assert.ok(assets.includes('fx-ripple'));
  });
  it('round-trips a fixed authored sun into runtime visuals and rejects invalid angles', () => {
    const document = emptyScene();
    assert.equal(parseSceneDocument(document).look.sun, undefined);
    document.look.sun = { azimuthDeg: 90, elevationDeg: 35 };
    const parsed = parseSceneDocument(JSON.parse(JSON.stringify(document)));
    assert.deepEqual(resolveAuthoredScene(parsed).look?.sun, document.look.sun);
    for (const sun of [
      { azimuthDeg: 181, elevationDeg: 35 },
      { azimuthDeg: 90, elevationDeg: 0 },
      { azimuthDeg: 90, elevationDeg: 90 },
    ])
      assert.throws(() => parseSceneDocument({ ...document, look: { ...document.look, sun } }));
  });
  it('commits edits and history only after view acceptance, preserving redo and replacement on failure', async () => {
    const original = emptyScene(),
      controller = new AbortController();
    let displayed = original,
      reject = false;
    let finish: (() => void) | undefined;
    const state = new EditorDocument(
      original,
      async (document) => {
        displayed = parseSceneDocument(document);
        if (reject) {
          reject = false;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          throw new Error('lighting unavailable');
        }
      },
      () => {},
      controller.signal,
    );
    await state.edit((h) =>
      h.change((d) => {
        d.name = 'Accepted';
      }),
    );
    await state.edit((h) => h.undo());
    assert.equal(state.history.canRedo, true);
    reject = true;
    const failing = state.edit((h) => {
      h.redo();
      h.change((d) => {
        d.name = 'Rejected';
      });
    });
    assert.equal(displayed.name, 'Rejected');
    assert.deepEqual(state.history.document, original);
    assert.equal(state.history.canUndo, false);
    await assert.rejects(
      state.edit((h) => h.redo()),
      /in progress/,
    );
    finish!();
    await assert.rejects(failing, /lighting unavailable/);
    assert.deepEqual(displayed, original);
    assert.equal(state.history.canRedo, true);
    await state.edit((h) => h.redo());
    assert.equal(state.history.document.name, 'Accepted');
    reject = true;
    const replacing = state.replace({ ...original, id: 'replacement' });
    finish!();
    await assert.rejects(replacing, /lighting unavailable/);
    assert.equal(state.history.document.name, 'Accepted');
    await state.edit((h) => h.undo());
    assert.deepEqual(state.history.document, original);
  });
  it('isolates accepted scenes and undo from retained candidates, drafts and derived fragments', async () => {
    const original = sceneFixture('graveyard');
    let candidate!: EditorHistory, draft!: SceneDocument, finish!: () => void;
    const state = new EditorDocument(
      original,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      () => {},
      new AbortController().signal,
    );
    const before = state.history;
    const updating = state.edit((history) => {
      candidate = history;
      history.change((document) => {
        draft = document;
        document.name = 'Validated';
      });
    });
    // The callback may retain its history while the renderer is accepting the scene.
    candidate.change((document) => {
      document.name = 'Changed during acceptance';
    });
    draft.name = 'Changed through retained draft';
    finish();
    await updating;
    assert.equal(state.history.document.name, 'Validated');
    assert.equal(before.document.name, original.name);
    assert.equal(before.canUndo, false);
    const accepted = state.history;
    candidate.undo();
    assert.equal(state.history.document.name, 'Validated');
    // Even untyped integrations cannot bypass validation through nested snapshot data.
    assert.throws(() => {
      (accepted.document as SceneDocument).objects[0]!.x = 999;
    }, TypeError);
    const fragment = accepted.fragment(['family-tomb-west']);
    fragment[0]!.x = 999;
    const derived = sceneItems(accepted.document);
    const footprint = derived.find((p) => p.placement.id === 'family-tomb-west')!.placement
      .footprint!;
    (footprint as [number, number])[0] = 999;
    assert.deepEqual(accepted.document.objects, original.objects);
    state.reidentify('saved-copy', 'draft');
    assert.equal(accepted.document.id, original.id);
    assert.equal(state.history.document.id, 'saved-copy');
    const undoing = state.edit((history) => history.undo());
    finish();
    await undoing;
    assert.equal(state.history.document.name, original.name);
    assert.equal(state.history.document.id, 'saved-copy');
    assert.deepEqual(state.history.document.objects, original.objects);
  });
  it('discards staged edits on disposal without applying to a closed view', async () => {
    const original = emptyScene(),
      controller = new AbortController();
    let finish!: () => void,
      applies = 0;
    const state = new EditorDocument(
      original,
      async () => {
        applies++;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      () => {},
      controller.signal,
    );
    const pending = state.edit((h) =>
      h.change((d) => {
        d.name = 'Late';
      }),
    );
    controller.abort(new Error('closed'));
    finish();
    await assert.rejects(pending, /closed/);
    assert.deepEqual(state.history.document, original);
    assert.equal(state.history.canUndo, false);
    assert.equal(applies, 1);
  });
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
    const duplicate = h.duplicateMany(['family-tomb-west'])[0]!;
    h.removeMany([duplicate]);
    h.removeMany(['family-tomb-west']);
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
    for (const version of [2, 99])
      assert.throws(() => parseSceneDocument({ ...emptyScene(), version }));
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

it('mounted lamps follow edited supports through cascading undo', () => {
  const h = new EditorHistory(sceneFixture('chapel'));
  const lamp = () =>
    resolveAuthoredScene(h.document).props.find((p) => p.id === 'crypt-altar-candles')!;

  h.transform('crypt-altar', { x: 1, z: -6.5 });
  assert.ok(Math.abs(lamp().x - 0.93) < 1e-10);
  assert.equal(lamp().y, 1.15);
  const copy = h.duplicateMany(['crypt-altar-candles'])[0]!;
  h.removeMany([copy]);
  h.removeMany(['crypt-altar']);
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
