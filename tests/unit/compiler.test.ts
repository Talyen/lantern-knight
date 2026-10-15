import { writeJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { sourceFixture } from '../fixtures/source';
import { readAsset } from '../../tools/assets/io';
import { parseSource, parseManifest, type ManifestDraft } from '../../src/assets/schema';
import { exactSource } from '../../tools/assets/files';
import { createPreparationContext } from '../../tools/assets/context';
const writer = (workspace: string) =>
  createPreparationContext({
    workspace,
    budget: 16 * 1024 ** 2,
    sourceRoot: workspace,
    libraryRoot: workspace,
  });
const source = sourceFixture();
let fixtureDirectory: string | undefined;
after(async () => {
  if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true });
});
let fixture: Promise<{ root: string; manifest: ManifestDraft }> | undefined;
function compiledFixture() {
  return (fixture ??= (async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-source-fixture-'));
    fixtureDirectory = root;
    await writeJson(path.join(root, 'valid.json'), source);
    await sharp({
      create: {
        width: source.asset.canvas[0],
        height: source.asset.canvas[1],
        channels: 4,
        background: { r: 170, g: 70, b: 20, alpha: 1 },
      },
    })
      .png()
      .toFile(path.join(root, 'sample.png'));
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-manifest-fixture-'));
    try {
      const context = await writer(output);
      return {
        root,
        manifest: parseManifest(
          await context.compile('valid.json', 'public/generated', false, root),
        ),
      };
    } finally {
      await fs.rm(output, { recursive: true, force: true });
    }
  })());
}
const fixtureTexts: Record<string, string> = {};
for (const name of ['invalid-duration', 'invalid-camera', 'invalid-heading']) {
  const invalid = structuredClone(source);
  if (name === 'invalid-duration') invalid.asset.clips.walk!.d45!.durationsMs = [0];
  if (name === 'invalid-camera')
    Reflect.set(invalid.asset, 'contractId', 'unapproved-other-camera');
  if (name === 'invalid-heading') delete invalid.asset.clips.walk!.d225;
  fixtureTexts[name] = JSON.stringify(invalid);
}

test('valid supplied assets and deliberately invalid schema fixtures', async () => {
  const { manifest } = await compiledFixture();
  parseSource(source);
  assert.equal(
    parseSource({ ...source, asset: { ...source.asset, atlasSize: 8192 } }).asset.atlasSize,
    8192,
  );
  for (const name of ['invalid-duration', 'invalid-camera', 'invalid-heading'])
    assert.throws(() => parseSource(JSON.parse(fixtureTexts[name]!)));
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
  invalid.frames[0]!.rect[2] = 1;
  Reflect.set(invalid.frames[0]!, 'rotated', true);
  assert.throws(() => parseManifest(invalid));
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

test('compiler is byte deterministic; failed build preserves prior manifest; source confinement and case', async (t) => {
  const { root: fixtureRoot } = await compiledFixture();
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
  await fs.writeFile(path.join(dir, 'invalid.json'), fixtureTexts['invalid-duration']!);
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
  const input = sourceFixture();
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
});
