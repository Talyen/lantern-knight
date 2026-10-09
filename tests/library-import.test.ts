import { emptyScene } from '../src/editor/default-scene';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { manifestFixture } from './fixtures/manifest';
import { parseManifest, resolveClip } from '../src/assets/schema';
import { clipDuration, frameAt } from '../src/core/animation';
import {
  parseSceneDocument,
  convertLegacySceneDocument,
  validateSceneReferences,
  paletteKind,
  paletteClips,
} from '../src/content/scene-document';
import { EditorHistory } from '../src/editor/model';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetWriter } from '../tools/assets/io';
import { diskBytes } from '../tools/assets/cache';
it('keeps incremental output accounting within its reserved space and counts candidate links once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-writer-')),
    old = {
      workspace: process.env.LANTERN_ASSET_WORKSPACE,
      preparing: process.env.LANTERN_PREPARING,
      budget: process.env.LANTERN_PREPARE_BUDGET,
    };
  try {
    process.env.LANTERN_ASSET_WORKSPACE = root;
    process.env.LANTERN_PREPARING = '1';
    process.env.LANTERN_PREPARE_BUDGET = '64';
    const write = await assetWriter();
    await write('public/one.png', Buffer.alloc(40));
    await write('public/one.png', Buffer.alloc(30));
    await write('public/two.png', Buffer.alloc(32));
    await assert.rejects(write('public/three.png', Buffer.alloc(3)), /reserved cache space/);
    await assert.rejects(fs.access(path.join(root, 'public/three.png')));
    await fs.link(path.join(root, 'public/one.png'), path.join(root, 'public/candidate.png'));
    assert.equal(await diskBytes(root), 62);
  } finally {
    for (const [key, value] of Object.entries({
      LANTERN_ASSET_WORKSPACE: old.workspace,
      LANTERN_PREPARING: old.preparing,
      LANTERN_PREPARE_BUDGET: old.budget,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('preserves authoritative source registration, timing and extension conflicts without library access', () => {
  execFileSync('python3', ['-B', 'tests/library_import.py'], { cwd: process.cwd(), stdio: 'pipe' });
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
  assert.equal(saved.version, 4);
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
  validateSceneReferences(saved, undefined, manifests);
  assert.throws(
    () =>
      validateSceneReferences(
        { ...saved, objects: saved.objects.map((p) => ({ ...p, heading: 'd00' })) },
        undefined,
        manifests,
      ),
    /Unavailable facing/,
  );
  assert.throws(
    () =>
      validateSceneReferences(
        { ...saved, objects: saved.objects.map((p) => ({ ...p, mirror: true })) },
        undefined,
        manifests,
      ),
    /Mirroring unavailable/,
  );
});
it('requires explicit version 2 conversion and rejects disguised newer objects', () => {
  const original = { ...emptyScene(), version: 2 };
  assert.throws(() => parseSceneDocument(original), /explicit conversion/);
  assert.equal(convertLegacySceneDocument(original, 'study').version, 4);
  assert.equal(original.version, 2);
  assert.throws(
    () =>
      convertLegacySceneDocument(
        {
          ...original,
          objects: [
            { id: 'enemy', kind: 'character', asset: 'library-fixture', clip: 'move', x: 0, z: 0 },
          ],
        },
        'study',
      ),
    /version 2/,
  );
});
