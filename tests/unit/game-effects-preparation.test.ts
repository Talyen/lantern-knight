import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { manifestFixture } from '../fixtures/manifest';
import {
  packedCombatEffects,
  combatEffectCatalog,
  packedCombatManifest,
} from '../../src/content/combat-feedback';
import { prepare } from '../../tools/assets/prepare/prepare-game-effects';
import { createPreparationContext } from '../../tools/assets/context';
import { hash } from '../../tools/compiler';
import { parseManifest } from '../../src/assets/schema';

test('Game packing preserves original drawings, registration, timeline and transparent terminal holds', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-packed-effects-');
  const context = await createPreparationContext({
    workspace: root,
    budget: 32 * 1024 ** 2,
    sourceRoot: root,
    libraryRoot: root,
  });
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let y = 20; y < 25; y++)
    for (let x = 18; x < 28; x++) pixels.set([x * 4, y * 5, 91, 27 + x], (y * 64 + x) * 4);
  // Hidden RGB next to the soft edge must not be changed by alpha dilation.
  pixels.set([7, 92, 48, 0], (22 * 64 + 17) * 4);
  const image = await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
    .png()
    .toBuffer();
  const empty = await sharp(Buffer.alloc(pixels.length), {
    raw: { width: 64, height: 64, channels: 4 },
  })
    .png()
    .toBuffer();
  const originals = new Map<string, Buffer>();
  const receipts = [];
  const natives = new Map();
  for (const id of packedCombatEffects) {
    const native = manifestFixture(id);
    Object.assign(native.asset, {
      type: 'effect',
      viewMode: 'fixed-authored',
      category: 'effect',
      renderCategory: 'translucent',
      allowEmptyFrames: true,
      canvas: [64, 64],
      anchor: [32, 60],
    });
    const first = native.frames[0]!;
    Object.assign(first, {
      rect: [0, 0, 64, 64],
      trim: [0, 0, 64, 64],
      origin: 'imported-study',
      attachments: {},
    });
    delete first.registration;
    const last = { ...first, id: 'terminal', page: 'empty', source: 'frames/terminal.png' };
    native.frames.push(last);
    const p = native.pages[0]!;
    Object.assign(p, {
      path: 'first.png',
      width: 64,
      height: 64,
      rgbaBytes: pixels.length,
      bytes: image.length,
      hash: hash(image),
      mipmaps: false,
    });
    native.pages.push({
      ...p,
      id: 'empty',
      path: 'empty.png',
      bytes: empty.length,
      hash: hash(empty),
    });
    native.asset.requiredClips = ['show'];
    native.asset.fallbacks = {};
    native.asset.clips = {
      show: {
        d45: {
          frames: [first.id, last.id],
          durationsMs: [17, 33],
          loop: false,
          endBehavior: 'hide',
          markers: [{ id: 'contact', atMs: 17 }],
          notifies: [],
        },
      },
    };
    const file = combatEffectCatalog[id]!;
    await context.writeAsset('public/' + file, JSON.stringify(native));
    for (const [name, bytes] of [
      ['first.png', image],
      ['empty.png', empty],
    ] as const) {
      const output = path.posix.join(path.posix.dirname(file), name);
      await context.writeAsset('public/' + output, bytes);
      receipts.push({
        asset: id,
        group: 'fixture',
        member: id + '/' + name,
        sha256: hash(bytes),
        outputHash: hash(bytes),
        file: output,
      });
      originals.set(id + '/' + name, bytes);
    }
    natives.set(id, native);
  }
  await context.writeAsset('metadata/library/receipt.json', JSON.stringify({ sources: receipts }));
  const scoped = {
    ...context,
    readLibrarySource: async (member: string) => originals.get(member)!,
  };
  await prepare(scoped);
  for (const id of packedCombatEffects) {
    const file = packedCombatManifest(id);
    const packed = parseManifest(JSON.parse(await context.readAsset('public/' + file, 'utf8')));
    const native = natives.get(id)!;
    assert.deepEqual(packed.asset.clips, native.asset.clips);
    assert.deepEqual(packed.asset.canvas, native.asset.canvas);
    assert.deepEqual(packed.asset.anchor, native.asset.anchor);
    assert.deepEqual(
      packed.frames.map((f) => f.id),
      native.frames.map((f: { id: string }) => f.id),
    );
    assert.ok(packed.pages.reduce((sum, p) => sum + p.rgbaBytes, 0) < pixels.length * 2);
    for (const frame of packed.frames) {
      const page = packed.pages.find((p) => p.id === frame.page)!;
      const [left, top, width, height] = frame.rect;
      const crop = await sharp(
        await context.readAsset('public/' + path.posix.join(path.posix.dirname(file), page.path)),
      )
        .extract({ left, top, width, height })
        .raw()
        .toBuffer();
      const restored = Buffer.alloc(pixels.length);
      for (let y = 0; y < height; y++)
        crop.copy(
          restored,
          ((frame.trim[1] + y) * 64 + frame.trim[0]) * 4,
          y * width * 4,
          (y + 1) * width * 4,
        );
      const expected = frame.id === 'terminal' ? Buffer.alloc(pixels.length) : pixels;
      assert.deepEqual(restored, expected, 'Every source pixel in the retained crop is exact');
    }
    assert.deepEqual(
      await fs.readFile(
        path.join(root, 'public', path.posix.dirname(combatEffectCatalog[id]!), 'first.png'),
      ),
      image,
    );
  }
  await assert.rejects(
    prepare({ ...scoped, readLibrarySource: async () => Buffer.from('changed source') }),
    /Original effect drawing differs/,
  );
});
