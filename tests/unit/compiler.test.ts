import { writeJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compilerSourceFixture } from '../fixtures/source';
import { readAsset } from '../../tools/assets/io';
import { exactSource } from '../../tools/assets/files';
import { createPreparationContext } from '../../tools/assets/context';
const writer = (workspace: string) =>
  createPreparationContext({
    workspace,
    budget: 16 * 1024 ** 2,
    sourceRoot: workspace,
    libraryRoot: workspace,
  });
const source = compilerSourceFixture();
test('compiler is byte deterministic; failed build preserves prior manifest; source confinement and case', async (t) => {
  const fixtureRoot = await temporaryDirectory(t, 'lantern-source-fixture-');
  await writeJson(path.join(fixtureRoot, 'valid.json'), source);
  await sharp({
    create: {
      width: source.asset.canvas[0],
      height: source.asset.canvas[1],
      channels: 4,
      background: { r: 170, g: 70, b: 20, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(fixtureRoot, 'sample.png'));
  const dir = await temporaryDirectory(t, 'lantern-compiler-');

  const context = await writer(dir);
  const a = await context.compile('valid.json', 'public/generated', false, fixtureRoot);
  const before = await readAsset(path.join(dir, 'public/generated/manifest.json'));
  const pages = await Promise.all(
    a.pages.map((page) => readAsset(path.join(dir, 'public/generated', page.path))),
  );
  const unchanged = async () => {
    assert.deepEqual(await readAsset(path.join(dir, 'public/generated/manifest.json')), before);
    assert.deepEqual(
      await Promise.all(
        a.pages.map((page) => readAsset(path.join(dir, 'public/generated', page.path))),
      ),
      pages,
    );
  };
  const b = await context.compile('valid.json', 'public/generated', false, fixtureRoot);
  assert.equal(a.hash, b.hash);
  await unchanged();
  const invalid = structuredClone(source);
  invalid.asset.clips.walk!.d45!.durationsMs = [0];
  await writeJson(path.join(dir, 'invalid.json'), invalid);
  await assert.rejects(context.compile('invalid.json', 'public/generated', false, dir));
  await unchanged();
  // A later frame fails after the first image was decoded and packed.
  const missing = structuredClone(source);
  missing.frames.push({ ...missing.frames[0]!, id: 'missing', path: 'missing.png' });
  await writeJson(path.join(dir, 'missing.json'), missing);
  await fs.copyFile(path.join(fixtureRoot, 'sample.png'), path.join(dir, 'sample.png'));
  await assert.rejects(
    context.compile('missing.json', 'public/generated', false, dir),
    /missing file: missing.png/,
  );
  await unchanged();
  await assert.rejects(exactSource('../package.json', fixtureRoot));
  await assert.rejects(exactSource('VALID.json', fixtureRoot), /case/);
});

test('atlas rollover preserves asymmetric pixels and supplies alpha for RGB artwork', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-atlas-packing-');
  const input = compilerSourceFixture();
  Object.assign(input.asset, { canvas: [8, 8], anchor: [4, 7], density: 4, atlasSize: 32 });
  input.frames = Array.from({ length: 5 }, (_, i) => ({
    id: i === 0 ? 'sample-frame' : 'drawing-' + i,
    path: i + '.png',
    origin: 'diagnostic' as const,
    attachments: {},
  }));
  const drawings: Buffer[] = [];
  for (let i = 0; i < input.frames.length; i++) {
    const pixels = Buffer.alloc(8 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) pixels.set([30 + i * 40, y * 30, x * 30, 255], (y * 8 + x) * 4);
    drawings.push(pixels);
    const image = sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } });
    // One RGB source protects alpha synthesis in the same real encoding pass.
    await (i === 0 ? image.removeAlpha() : image)
      .png()
      .toFile(path.join(root, input.frames[i]!.path));
  }
  await writeJson(path.join(root, 'source.json'), input);
  const context = await writer(root);
  const result = await context.compile('source.json', 'public/generated', false, root);
  assert.equal(result.pages.length, 2);
  assert.equal(result.frames.length, input.frames.length);
  for (const [i, frame] of result.frames.entries()) {
    assert.deepEqual(frame.trim, [0, 0, 8, 8]);
    const page = result.pages.find((page) => page.id === frame.page)!;
    const [left, top, width, height] = frame.rect;
    const pixels = await sharp(await readAsset(path.join(root, 'public/generated', page.path)))
      .extract({ left, top, width, height })
      .raw()
      .toBuffer();
    assert.deepEqual(pixels, drawings[i], frame.id);
  }
  const accepted = await fs.readFile(path.join(root, 'public/generated/manifest.json'));
  const missing = structuredClone(input);
  missing.frames.push({ ...missing.frames[0]!, id: 'missing', path: 'missing.png' });
  await writeJson(path.join(root, 'source.json'), missing);
  await assert.rejects(
    context.compile('source.json', 'public/generated', false, root),
    /missing file/,
  );
  assert.deepEqual(await fs.readFile(path.join(root, 'public/generated/manifest.json')), accepted);
});
