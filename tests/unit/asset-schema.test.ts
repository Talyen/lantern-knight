import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseManifest } from '../../src/assets/schema';
import { resolveClip, resolveActorClip } from '../../src/assets/clips';
import { sourceFixture } from '../fixtures/source';
import { manifestFixture } from '../fixtures/manifest';
const source = sourceFixture();
test('asset admission accepts valid metadata and rejects malformed geometry and references', () => {
  const manifest = manifestFixture();
  parseSource(source);
  assert.equal(
    parseSource({ ...source, asset: { ...source.asset, atlasSize: 8192 } }).asset.atlasSize,
    8192,
  );
  for (const corrupt of [
    (draft: typeof source) => {
      draft.asset.clips.walk!.d45!.durationsMs = [0];
    },
    (draft: typeof source) => {
      Reflect.set(draft.asset, 'contractId', 'unapproved-other-camera');
    },
    (draft: typeof source) => {
      delete draft.asset.clips.walk!.d225;
    },
  ]) {
    const draft = structuredClone(source);
    corrupt(draft);
    assert.throws(() => parseSource(draft));
  }
  const duplicate = structuredClone(source);
  duplicate.frames.push(duplicate.frames[0]!);
  assert.throws(() => parseSource(duplicate), /duplicate/);
  const invalid = structuredClone(manifest);
  const standalone = structuredClone(manifest);
  standalone.pages[0]!.width = 6144;
  standalone.pages[0]!.height = 4096;
  standalone.pages[0]!.rgbaBytes = 6144 * 4096 * 4;
  assert.equal(parseManifest(standalone).pages[0]!.width, 6144);
  standalone.pages[0]!.rgbaBytes--;
  assert.throws(() => parseManifest(standalone), /byte estimate/);
  invalid.frames[0]!.rect[2] = 99999;
  assert.throws(() => parseManifest(invalid), /bounds/);
  const rotated = structuredClone(manifest);
  Reflect.set(rotated.frames[0]!, 'rotated', true);
  assert.throws(() => parseManifest(rotated), /rotated/);
  const nonFinite = structuredClone(source);
  nonFinite.asset.density = Infinity;
  assert.throws(() => parseSource(nonFinite));
  const missingDep = structuredClone(manifest);
  missingDep.bundles[Object.keys(missingDep.bundles)[0]!]!.dependencies = ['missing'];
  assert.throws(() => parseManifest(missingDep), /dependency/);
  missingDep.bundles[Object.keys(missingDep.bundles)[0]!]!.dependencies = [
    Object.keys(missingDep.bundles)[0]!,
  ];
  assert.throws(() => parseManifest(missingDep), /cyclic/);
  const looping = structuredClone(manifest);
  looping.asset.clips.death!.d00!.loop = true;
  parseManifest(looping);
});

test('every delivered facing is validated, including extra four-directional and mixed facings', () => {
  for (const viewMode of ['four-directional', 'mixed-directional'] as const)
    for (const corrupt of [
      (clip: (typeof source.asset.clips)[string]['d45']) => {
        clip!.frames = ['missing'];
      },
      (clip: (typeof source.asset.clips)[string]['d45']) => {
        clip!.durationsMs = [100, 200];
      },
      (clip: (typeof source.asset.clips)[string]['d45']) => {
        clip!.notifies = [{ id: 'late', atMs: 500, kind: 'flash' }];
      },
      (clip: (typeof source.asset.clips)[string]['d45']) => {
        clip!.loop = true;
        clip!.endBehavior = 'hide';
      },
    ]) {
      const draft = structuredClone(source);
      draft.asset.viewMode = viewMode;
      corrupt(draft.asset.clips.idle!.d45);
      assert.throws(() => parseSource(draft), /clips.idle.d45/);
    }
});

test('clip references resolve own identities, including explicit prototype-named aliases', () => {
  const draft = structuredClone(source);
  draft.asset.fallbacks = { constructor: 'walk' };
  parseSource(draft);
  const manifest = manifestFixture();
  manifest.asset = draft.asset;
  const walk = resolveClip(manifest, 'walk', 'd45');
  assert.equal(resolveClip(manifest, 'constructor', 'd45'), walk);
  manifest.asset.viewMode = 'supplied';
  assert.equal(resolveActorClip(manifest, 'constructor', 'd45'), walk);
  draft.asset.fallbacks = { run: 'constructor' };
  assert.throws(() => parseSource(draft), /fallback target/);
  draft.asset.fallbacks = {};
  draft.asset.requiredClips = ['constructor'];
  assert.throws(() => parseSource(draft), /missing constructor/);
});

test('clip timelines stay finite and marker identities remain unambiguous', () => {
  const draft = structuredClone(source),
    clip = draft.asset.clips.idle!.d00!;
  clip.frames = [clip.frames[0]!, clip.frames[0]!];
  clip.durationsMs = [Number.MAX_VALUE, Number.MAX_VALUE];
  assert.throws(() => parseSource(draft), /non-finite clip duration/);
  clip.durationsMs = [100, 200];
  clip.markers = [
    { id: 'contact', atMs: 100 },
    { id: 'contact', atMs: 200 },
  ];
  assert.throws(() => parseSource(draft), /markers.*duplicate ID/);
  clip.markers[1]!.id = 'end';
  clip.markers[1]!.atMs = 300;
  parseSource(draft);
});

test('asset identities require SHA-256 hex rather than arbitrary 64-character strings', () => {
  for (const corrupt of [
    (manifest: ReturnType<typeof manifestFixture>) => {
      manifest.hash = 'z'.repeat(64);
    },
    (manifest: ReturnType<typeof manifestFixture>) => {
      manifest.pages[0]!.hash = 'z'.repeat(64);
    },
    (manifest: ReturnType<typeof manifestFixture>) => {
      manifest.asset.canonicalReferenceHash = 'z'.repeat(64);
    },
  ]) {
    const manifest = manifestFixture();
    corrupt(manifest);
    assert.throws(() => parseManifest(manifest));
  }
});

test('wide atlas previews allow normal integer rounding without rejecting the asset', () => {
  const manifest = manifestFixture('wide-flame');
  const page = manifest.pages[0]!;
  page.width = 6144;
  page.height = 512;
  page.rgbaBytes = 6144 * 512 * 4;
  page.preview = {
    path: 'preview.png',
    hash: 'c'.repeat(64),
    width: 512,
    height: 43,
    bytes: 1,
    gpuBytes: 512 * 43 * 4,
    encoding: 'png',
    mipmaps: false,
  };
  parseManifest(manifest);
});

test('bundle validation accepts shared dependency graphs and rejects inherited dependencies and cycles', () => {
  const manifest = manifestFixture();
  manifest.bundles = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [
      'bundle-' + i,
      {
        required: [],
        optional: [],
        dependencies: i < 2 ? [] : ['bundle-' + (i - 1), 'bundle-' + (i - 2)],
      },
    ]),
  );
  parseManifest(manifest);
  manifest.bundles['bundle-0']!.dependencies = ['constructor'];
  assert.throws(() => parseManifest(manifest), /missing dependency constructor/);
  manifest.bundles['bundle-0']!.dependencies = ['bundle-31'];
  assert.throws(() => parseManifest(manifest), /cyclic dependency/);
});
