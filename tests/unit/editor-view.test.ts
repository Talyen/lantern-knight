import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { EditorView } from '../../src/editor/view';
import { EditorDocument } from '../../src/editor/document';
import { emptyScene } from '../../src/editor/default-scene';
import { AssetRuntime, type PackLease } from '../../src/assets/loader';
import { manifestFixture } from '../fixtures/manifest';

test('editor acceptance hides failed rebuilds, recovers and preserves installed texture lifetimes', async () => {
  const original = emptyScene();
  delete original.floor.clip;
  const loaded: PackLease[] = [],
    released: PackLease[] = [],
    runtime = new AssetRuntime({
      'ink-moss': 'generated/moss.json',
      'ink-mud': 'generated/mud.json',
    });
  runtime.loadPack = async (id) => {
    const manifest = manifestFixture(id);
    manifest.asset.type = 'material';
    manifest.asset.projection = 'top-down';
    const pack = { manifest, textures: new Map(), release: () => released.push(pack) };
    loaded.push(pack);
    return pack;
  };
  let failLighting = 0;
  let frames = 0;
  let warmCalls = 0;
  let referenced: PackLease | undefined;
  const presentation = {
    scene: new Group(),
    overlay: new Group(),
    async warm() {
      if (++warmCalls === 1) {
        throw new Error('warm failed');
      }
    },
    update() {
      frames++;
    },
    roomPresentation: {},
    resetRoom() {
      if (referenced)
        assert.equal(
          released.includes(referenced),
          false,
          'Previous renderer textures stay alive until rebuilding discards their references',
        );
      referenced = loaded.at(-1);
    },
    lookRenderer: {
      setSettings() {},
      async prepare() {
        if (failLighting) {
          failLighting--;
          throw new Error('lighting failed');
        }
      },
    },
    dispose() {
      assert.equal(released.includes(loaded.at(-1)!), false);
    },
  };
  const view = new EditorView(
    {} as HTMLCanvasElement,
    runtime,
    () => presentation as unknown as NonNullable<EditorView['presentation']>,
  );
  const documents = new EditorDocument(
    original,
    async (document) => {
      await view.apply(document);
      assert.equal(released.includes(loaded.at(-1)!), false);
    },
    () => {},
    new AbortController().signal,
  );
  try {
    await assert.rejects(view.apply(original), /warm failed/);
    assert.equal(view.presentation, undefined);
    await view.apply(original);
    assert.equal(warmCalls, 2, 'Recovery retries incomplete renderer warming');
    failLighting = 1;
    await assert.rejects(
      documents.edit((history) =>
        history.change((d) => {
          d.floor.asset = 'ink-mud';
        }),
      ),
      /lighting failed/,
    );
    assert.equal(documents.history.document.floor.asset, original.floor.asset);
    assert.equal(loaded.length, 4, 'Rollback reacquires the accepted document before rebuilding');
    assert.deepEqual(released, loaded.slice(0, 3));
    assert.equal(view.presentation, presentation);
    view.render();
    assert.equal(frames, 1);

    const loadPack = runtime.loadPack.bind(runtime);
    runtime.loadPack = async () => {
      throw new Error('pack unavailable');
    };
    const replacing = view.apply({ ...original, floor: { ...original.floor, asset: 'ink-mud' } });
    assert.equal(view.presentation, undefined, 'Pending replacement suspends borrowing');
    await assert.rejects(view.apply(original), /Scene update in progress/);
    await assert.rejects(replacing, /pack unavailable/);
    runtime.loadPack = loadPack;
    assert.equal(view.presentation, presentation, 'Precommit failure preserves room acceptance');

    failLighting = 2;
    await assert.rejects(
      documents.edit((history) =>
        history.change((d) => {
          d.floor.asset = 'ink-mud';
        }),
      ),
      /Scene update and view recovery failed/,
    );
    assert.equal(documents.history.document.floor.asset, original.floor.asset);
    assert.equal(view.presentation, undefined, 'Failed rollback cannot expose a partial renderer');
    assert.equal(view.sim, undefined, 'Rejected gameplay geometry stays behind the same barrier');
    view.render();
    assert.equal(frames, 1, 'Frame scheduling cannot resume the rejected scene');
    assert.equal(view.ground(0, 0), null);
    assert.equal(view.pick(0, 0, original), undefined);
    await view.apply(original);
    assert.equal(view.presentation, presentation);
    view.render();
    assert.equal(frames, 2, 'A successful rebuild reopens the view');
    view.dispose();
    assert.equal(view.presentation, undefined);
    view.render();
    assert.equal(frames, 2);
    assert.deepEqual(released, loaded);
  } finally {
    runtime.dispose();
  }
});
