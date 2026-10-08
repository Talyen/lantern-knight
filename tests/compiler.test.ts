import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readAsset } from '../tools/assets/io';
import { parseSource, parseManifest } from '../src/assets/schema';
import { compile, exactSource } from '../tools/compiler';
const read = async (p: string) => JSON.parse(await readAsset(p, 'utf8'));
const source = await read('tests/fixtures/valid.json');
let fixture: Promise<{ root: string; manifest: any }> | undefined;
function compiledFixture() {
  return (fixture ??= (async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-source-fixture-'));
    await fs.writeFile(path.join(root, 'valid.json'), JSON.stringify(source));
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
      return {
        root,
        manifest: JSON.parse(
          JSON.stringify(await compile('valid.json', output, false, false, root)),
        ),
      };
    } finally {
      await fs.rm(output, { recursive: true, force: true });
    }
  })());
}
import { after } from 'node:test';
after(async () => {
  if (fixture) await fs.rm((await fixture).root, { recursive: true, force: true });
});
const fixtureTexts: Record<string, string> = {};
for (const name of ['invalid-duration', 'invalid-camera', 'invalid-heading']) {
  const invalid = structuredClone(source);
  if (name === 'invalid-duration') invalid.asset.clips.walk.d45.durationsMs = [0];
  if (name === 'invalid-camera') invalid.asset.contractId = 'unapproved-other-camera';
  if (name === 'invalid-heading') delete invalid.asset.clips.walk.d225;
  fixtureTexts[name] = JSON.stringify(invalid);
}

test('valid and deliberately invalid schema fixtures; production fails closed', async () => {
  const { manifest } = await compiledFixture();
  parseSource(source);
  for (const name of ['invalid-duration', 'invalid-camera', 'invalid-heading'])
    assert.throws(() => parseSource(JSON.parse(requireText(name))));
  function requireText(name: string) {
    return fixtureTexts[name]!;
  }
  assert.throws(() => parseSource(source, true), /production/);
  const duplicate = structuredClone(source);
  duplicate.frames.push(duplicate.frames[0]);
  assert.throws(() => parseSource(duplicate), /duplicate/);
  const invalid = structuredClone(manifest);
  invalid.frames[0].rect[2] = 99999;
  assert.throws(() => parseManifest(invalid), /bounds/);
  invalid.frames[0].rect[2] = 1;
  invalid.frames[0].rotated = true;
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
  looping.asset.clips.death.d00.loop = true;
  assert.throws(() => parseManifest(looping), /loop/);
});

test('compiler is byte deterministic; failed build preserves prior manifest; source confinement and case', async () => {
  const { root: fixtureRoot } = await compiledFixture();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-compiler-'));
  try {
    const a = await compile('valid.json', dir, false, false, fixtureRoot);
    const before = await readAsset(path.join(dir, 'manifest.json'));
    const b = await compile('valid.json', dir, false, false, fixtureRoot);
    assert.equal(a.hash, b.hash);
    assert.deepEqual(await readAsset(path.join(dir, 'manifest.json')), before);
    await fs.writeFile(path.join(dir, 'invalid.json'), fixtureTexts['invalid-duration']!);
    await assert.rejects(compile('invalid.json', dir, false, false, dir));
    assert.deepEqual(await readAsset(path.join(dir, 'manifest.json')), before);
    await assert.rejects(exactSource('../package.json', fixtureRoot));
    await assert.rejects(exactSource('VALID.json', fixtureRoot), /case/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('compiler rejects an opaque RGB concept input and keeps its prior published manifest', async () => {
  const { root: fixtureRoot } = await compiledFixture();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-alpha-'));
  const bad = structuredClone(source),
    file = path.join(dir, 'no-alpha.png'),
    input = path.join(dir, 'invalid-alpha.json');
  try {
    await compile('valid.json', dir, false, false, fixtureRoot);
    const before = await readAsset(path.join(dir, 'manifest.json'));
    await sharp(path.join(fixtureRoot, bad.frames[0].path))
      .flatten({ background: '#ffffff' })
      .png()
      .toFile(file);
    bad.frames[0].path = 'no-alpha.png';
    await fs.writeFile(input, JSON.stringify(bad));
    await assert.rejects(compile('invalid-alpha.json', dir, false, false, dir), /alpha/);
    assert.deepEqual(await readAsset(path.join(dir, 'manifest.json')), before);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(file, { force: true });
    await fs.rm(input, { force: true });
  }
});
