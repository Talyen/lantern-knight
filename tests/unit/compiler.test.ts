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
  const b = await context.compile('valid.json', 'public/generated', false, fixtureRoot);
  assert.equal(a.hash, b.hash);
  assert.deepEqual(await readAsset(path.join(dir, 'public/generated/manifest.json')), before);
  await fs.writeFile(path.join(dir, 'invalid.json'), fixtureTexts['invalid-duration']!);
  await assert.rejects(context.compile('invalid.json', 'public/generated', false, dir));
  assert.deepEqual(await readAsset(path.join(dir, 'public/generated/manifest.json')), before);
  await assert.rejects(exactSource('../package.json', fixtureRoot));
  await assert.rejects(exactSource('VALID.json', fixtureRoot), /case/);
});

test('compiler accepts opaque RGB artwork and supplies an opaque alpha channel', async (t) => {
  const { root: fixtureRoot } = await compiledFixture();
  const dir = await temporaryDirectory(t, 'lantern-alpha-');
  const bad = structuredClone(source),
    file = path.join(dir, 'no-alpha.png'),
    input = path.join(dir, 'invalid-alpha.json');

  const context = await writer(dir);
  await context.compile('valid.json', 'public/generated', false, fixtureRoot);
  await sharp(path.join(fixtureRoot, bad.frames[0]!.path))
    .flatten({ background: '#ffffff' })
    .png()
    .toFile(file);
  bad.frames[0]!.path = 'no-alpha.png';
  await writeJson(input, bad);
  const result = await context.compile('invalid-alpha.json', 'public/generated', false, dir);
  assert.ok(result.frames.length > 0);
  const page = result.pages[0]!;
  const pixels = await sharp(await readAsset(path.join(dir, 'public/generated', page.path)))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.ok(pixels.includes(255));
});
