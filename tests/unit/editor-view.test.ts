import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { EditorView } from '../../src/editor/view';
import { EditorDocument } from '../../src/editor/document';
import { emptyScene } from '../../src/editor/default-scene';
import { AssetRuntime, type PackLease } from '../../src/assets/loader';
import { manifestFixture } from '../fixtures/manifest';

test('editor recovery keeps installed textures alive through failed lighting and document rollback', async () => {
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
  const view = new EditorView({} as HTMLCanvasElement, runtime);
  let failLighting = false;
  let referenced: PackLease | undefined;
  const presentation = {
    overlay: new Group(),
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
          failLighting = false;
          throw new Error('lighting failed');
        }
      },
    },
    dispose() {
      assert.equal(released.includes(loaded.at(-1)!), false);
    },
  };
  view.presentation = presentation as unknown as NonNullable<EditorView['presentation']>;
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
    await view.apply(original);
    failLighting = true;
    await assert.rejects(
      documents.edit((history) =>
        history.change((d) => {
          d.floor.asset = 'ink-mud';
        }),
      ),
      /lighting failed/,
    );
    assert.equal(documents.history.document.floor.asset, original.floor.asset);
    assert.equal(loaded.length, 3, 'Rollback reacquires the accepted document before rebuilding');
    assert.deepEqual(released, loaded.slice(0, 2));
    view.dispose();
    assert.deepEqual(released, loaded);
  } finally {
    runtime.dispose();
  }
});
