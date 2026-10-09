import { emptyScene } from '../../src/editor/default-scene';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { manifestFixture } from '../fixtures/manifest';
import { parseManifest, resolveClip } from '../../src/assets/schema';
import { clipDuration, frameAt } from '../../src/core/animation';
import {
  parseSceneDocument,
  validateSceneReferences,
  paletteKind,
  paletteClips,
} from '../../src/content/scene-document';
import { EditorHistory } from '../../src/editor/model';
it('preserves authoritative source registration, timing and extension conflicts without library access', () => {
  execFileSync('python3', ['-B', 'tests/assets/library_import.py'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
});
it('exposes only supplied directions while preserving complete-asset coverage requirements', () => {
  const original = manifestFixture('library-fixture'),
    clip = Object.values(Object.values(original.asset.clips)[0]!)[0]!;
  const m = parseManifest({
    ...original,
    asset: {
      ...original.asset,
      viewMode: 'supplied',
      status: 'proxy',
      renderStyle: 'clean-ink',
      type: 'character',
      placement: 'upright',
      mirroring: false,
      clips: {
        move: { d90: clip },
        attack: { d90: { ...clip, loop: false, endBehavior: 'hide' } },
      },
      requiredClips: [],
      fallbacks: {},
    },
  });
  assert.equal(paletteKind(m), 'character');
  assert.deepEqual(paletteClips(m), ['move', 'attack']);
  assert.throws(() => resolveClip(m, 'move', 'd00'), /unavailable/);
  assert.throws(
    () => parseManifest({ ...m, asset: { ...m.asset, viewMode: 'four-directional' } }),
    /missing required heading/,
  );
  const one = resolveClip(m, 'attack', 'd90');
  assert.equal(frameAt(one, clipDuration(one) + 100), one.frames.at(-1));
  const h = new EditorHistory(emptyScene());
  h.change((d) =>
    d.objects.push({
      id: 'actor',
      kind: 'character',
      asset: m.asset.id,
      clip: 'move',
      heading: 'd90',
      x: 0,
      z: 0,
    }),
  );
  const saved = parseSceneDocument(JSON.parse(JSON.stringify(h.document)));
  assert.equal(saved.version, 5);
  assert.equal(saved.objects[0]!.heading, 'd90');
  h.undo();
  assert.equal(h.document.objects.length, 0);
  h.redo();
  assert.equal(h.document.objects[0]!.heading, 'd90');
  const floor = parseManifest({
    ...original,
    asset: {
      ...original.asset,
      id: 'ink-moss',
      type: 'material',
      status: 'proxy',
      renderStyle: 'clean-ink',
      projection: 'top-down',
      viewMode: 'fixed-authored',
      clips: {
        surface: { d45: { ...clip, frames: [clip.frames[0]!], durationsMs: [1000], loop: true } },
      },
      requiredClips: [],
      fallbacks: {},
    },
  });
  const manifests = new Map([
    [m.asset.id, m],
    ['ink-moss', floor],
  ]);
  validateSceneReferences(saved, manifests);
  assert.throws(
    () =>
      validateSceneReferences(
        { ...saved, objects: saved.objects.map((p) => ({ ...p, heading: 'd00' })) },
        manifests,
      ),
    /Unavailable facing/,
  );
  assert.doesNotThrow(() =>
    validateSceneReferences(
      { ...saved, objects: saved.objects.map((p) => ({ ...p, mirror: true })) },
      manifests,
    ),
  );
});
