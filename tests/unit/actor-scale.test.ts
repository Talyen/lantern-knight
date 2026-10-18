import test from 'node:test';
import assert from 'node:assert/strict';
import packs from '../../assets/library-packs.json';
import { actorFrameScales, scaleActorRegistration } from '../../tools/assets/actor-scale';
import {
  libraryFrameScales,
  nativeDrawingKey,
  scaleClips,
  scaleSourceIdentity,
  validateScaleCoverage,
  type ScaleAsset,
  type LibraryScaleRecipe,
} from '../../tools/assets/library-scale';

const group = packs.packs.find((pack) => pack.category === 2)!.group;
function fixture(): ScaleAsset {
  return {
    id: 'library-enemy',
    label: 'Enemy',
    type: 'character',
    clips: {
      move: {
        d90: {
          frames: [0, 1].map((i) => ({
            group,
            member: `frame-${i}.png`,
            sourceSha256: String(i + 1).repeat(64),
            canvas: [640, 640],
            anchor: [320, 520],
            density: i ? 280 : 256,
          })),
          durationsMs: [70, 120],
          loop: true,
          endBehavior: 'hold',
        },
      },
    },
  };
}
function recipe(asset: ScaleAsset): LibraryScaleRecipe {
  return {
    schemaVersion: 1,
    assets: {
      [asset.id]: {
        baseline: 'Native neutral movement drawing; retain enemy size.',
        notes: 'Retain source bob, compression and supplied density correction.',
        sourceSha256: scaleSourceIdentity(asset),
        clips: { 'move:d90': 1 },
        frames: {},
      },
    },
  };
}

test('library calibration composes with supplied density without changing native geometry or pixels', () => {
  const asset = fixture(),
    review = recipe(asset),
    native = asset.clips.move!.d90!.frames[1]!;
  review.assets[asset.id]!.frames[nativeDrawingKey(native)] = 1.1;
  const scales = libraryFrameScales(asset, validateScaleCoverage([asset], review))!;
  assert.equal(scales.get(nativeDrawingKey(asset.clips.move!.d90!.frames[0]!)), 1);
  const corrected = scaleActorRegistration(native, scales.get(nativeDrawingKey(native))!);
  assert.equal(corrected.density, 280 / 1.1);
  assert.equal(native.density, 280);
  assert.deepEqual(corrected.anchor, native.anchor);
  assert.deepEqual(corrected.canvas, native.canvas);
  assert.equal(corrected.sourceSha256, native.sourceSha256);
  assert.deepEqual(asset.clips.move!.d90!.durationsMs, [70, 120]);
});

test('pixel identity survives source relocation and distinguishes atlas cells and native registration', () => {
  const asset = fixture(),
    native = asset.clips.move!.d90!.frames[0]!,
    key = nativeDrawingKey(native);
  assert.equal(nativeDrawingKey({ ...native, group: 'new-group', member: 'moved/frame.png' }), key);
  assert.notEqual(
    nativeDrawingKey({ ...native, rect: [0, 0, 32, 36] }),
    nativeDrawingKey({ ...native, rect: [32, 0, 32, 36] }),
  );
  assert.notEqual(nativeDrawingKey({ ...native, density: 257 }), key);
  assert.throws(() => nativeDrawingKey({ ...native, sourceSha256: undefined }), /verified source/);
});

test('changed enemy drawings, registration, clip membership and removed assets invalidate review', () => {
  const asset = fixture(),
    review = recipe(asset);
  for (const change of [
    (a: ScaleAsset) => {
      a.clips.move!.d90!.frames[0]!.sourceSha256 = 'a'.repeat(64);
    },
    (a: ScaleAsset) => {
      a.clips.move!.d90!.frames[0]!.anchor[0]++;
    },
    (a: ScaleAsset) => {
      a.clips.move!.d90!.frames.reverse();
    },
    (a: ScaleAsset) => {
      a.clips.attack = structuredClone(a.clips.move!);
    },
  ]) {
    const changed = structuredClone(asset);
    change(changed);
    assert.throws(() => validateScaleCoverage([changed], review), /stale/);
  }
  assert.throws(
    () => validateScaleCoverage([asset], { schemaVersion: 1, assets: {} }),
    /needs scale review/,
  );
  assert.throws(() => validateScaleCoverage([], review), /Unknown actor/);
  const prop = { ...asset, id: 'library-prop', type: 'prop' };
  assert.equal(libraryFrameScales(prop, review), undefined);
});

test('shared native drawings cannot receive conflicting scales at action joins', () => {
  const asset = fixture();
  asset.clips.idle = {
    d90: { ...asset.clips.move!.d90!, frames: [asset.clips.move!.d90!.frames[0]!] },
  };
  const review = recipe(asset);
  review.assets[asset.id]!.clips['idle:d90'] = 1;
  review.assets[asset.id]!.clips['move:d90'] = 1.1;
  assert.throws(() => libraryFrameScales(asset, review), /Conflicting actor frame scale/);
});

test('review rejects missing clips and unknown drawing overrides, including inherited map keys', () => {
  const asset = fixture(),
    review = recipe(asset),
    own = review.assets[asset.id]!;
  own.clips = {};
  assert.throws(() => libraryFrameScales(asset, review), /exactly/);
  own.clips = { 'move:d90': 1 };
  own.frames = { missing: 1.1 };
  assert.throws(() => libraryFrameScales(asset, review), /Unknown actor scale drawing/);
  assert.deepEqual(scaleClips(asset)[0]!.frames.length, 2);
  const scales = actorFrameScales(
    { baseline: 'Neutral', notes: 'Keep pose', clips: { 'move:d90': 1 }, frames: {} },
    [{ id: 'move', heading: 'd90', frames: ['constructor'] }],
  );
  assert.equal(scales.get('constructor'), 1);
});
