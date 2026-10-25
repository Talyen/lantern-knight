import { readJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { selectedFiles, copySelectedFiles } from '../../tools/select-runtime-assets';
import { gameAssetCatalog } from '../../src/content/game-content';
import { loadingVideoPath } from '../../src/content/loading-media';
import { manifestFixture } from '../fixtures/manifest';
import { builtAssetReader, materializeBuiltAssets } from '../../tools/built-asset-reader';

test('runtime selection builds from delivery-only payloads and validates shipped images', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-runtime-selection-'),
    source = path.join(root, 'public'),
    image = Buffer.from('verified delivery fixture'),
    hash = createHash('sha256').update(image).digest('hex');
  const write = async (name: string, bytes: string | Buffer) => {
    const target = path.join(source, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  };

  for (const name of [
    'build-mode.json',
    'generated/calibration.json',
    'registration.json',
    'animation/flow.png',
    loadingVideoPath,
  ])
    await write(name, '{}');
  const selectedId = Object.keys(gameAssetCatalog)[0]!;
  const registration = JSON.stringify({
    schemaVersion: 2,
    animation: {
      width: 1,
      height: 1,
      canvas: [1, 1],
      bytes: 1,
      sha256: hash,
      tuningHash: hash,
      stagedSourceHash: hash,
      preparedHashes: {},
      pairs: [],
      offsets: {},
      clips: {},
    },
    coverage: {
      masks: {
        [selectedId + ':frame']: { width: 1, height: 1, alpha: [255] },
        'unused:frame': { width: 1, height: 1, alpha: [0] },
      },
      sockets: {},
    },
  });
  await write('registration.json', registration);
  await write(
    'build-mode.json',
    JSON.stringify({ registrationHash: createHash('sha256').update(registration).digest('hex') }),
  );
  await write('lighting/manifest.json', JSON.stringify({ entries: {} }));
  for (const [id, file] of Object.entries(gameAssetCatalog)) {
    const manifest = manifestFixture(id),
      page = manifest.pages[0]!,
      delivery = path.posix.join(path.posix.dirname(file), 'delivery.png');
    page.delivery = [
      {
        path: delivery,
        encoding: 'png',
        width: page.width,
        height: page.height,
        hash,
        bytes: image.length,
        gpuBytes: page.width * page.height * 4,
        mipmaps: false,
      },
    ];
    // This encoding is intentionally absent: strict Game cannot request it.
    page.delivery.push({
      ...page.delivery[0]!,
      path: delivery.replace(/\.png$/, '.ktx2'),
      encoding: 'ktx2-uastc',
    });
    await write(file, JSON.stringify(manifest));
    await write(delivery, image);
  }
  const legacy = await selectedFiles(source, 'game');
  let active = 0,
    peak = 0;
  const calls = new Map<string, number>();
  const parallel = await selectedFiles(source, 'game', async (name) => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
    peak = Math.max(peak, ++active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return true;
    } finally {
      active--;
    }
  });
  assert.deepEqual(parallel, legacy, 'Concurrent acquisition must preserve every artifact byte');
  assert.ok(peak > 1 && peak <= 8, 'Transfer admission is concurrent and bounded');
  assert.ok(
    [...calls.values()].every((count) => count === 1),
    'Repeated reads reuse admission',
  );
  await assert.rejects(
    selectedFiles(source, 'game', async (name) => {
      active++;
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (name === Object.values(gameAssetCatalog)[0]) throw new Error('transfer rejected');
        return true;
      } finally {
        active--;
      }
    }),
    /transfer rejected/,
  );
  assert.equal(active, 0, 'Failure drains every admitted transfer before releasing the workspace');
  assert.deepEqual(Object.keys(JSON.parse(legacy.generated['registration.json']!).coverage.masks), [
    selectedId + ':frame',
  ]);
  assert.ok(Object.keys(legacy.binary ?? {}).length > 0);
  const policy = JSON.parse(legacy.generated['build-mode.json']!);
  assert.equal(
    policy.registrationHash,
    createHash('sha256').update(legacy.generated['registration.json']!).digest('hex'),
  );
  assert.deepEqual(JSON.parse(legacy.generated['audio/manifest.json']!), {
    schemaVersion: 1,
    samples: [],
  });
  await copySelectedFiles(source, path.join(root, 'legacy-output'), legacy);
  assert.deepEqual(await readJson(path.join(root, 'legacy-output/audio/manifest.json')), {
    schemaVersion: 1,
    samples: [],
  });
  await write('audio/manifest.json', 'invalid JSON');
  await assert.rejects(selectedFiles(source, 'game'), SyntaxError);
  const audioBytes = Buffer.from('prepared audio fixture'),
    audioHash = createHash('sha256').update(audioBytes).digest('hex');
  const audioPath = `audio/${audioHash}.wav`;
  await write(audioPath, audioBytes);
  await write(
    'audio/manifest.json',
    JSON.stringify({
      schemaVersion: 1,
      samples: [
        {
          id: 'sword-1',
          cue: 'sword',
          path: audioPath,
          hash: audioHash,
          bytes: audioBytes.length,
          duration: 1,
          channels: 1,
          sampleRate: 44100,
          loop: false,
          loopStart: 0,
          loopEnd: 1,
        },
      ],
    }),
  );
  const inventory = await selectedFiles(source, 'game');
  assert.ok(inventory.files.includes(audioPath));
  await write(audioPath, 'corrupt audio');
  await assert.rejects(selectedFiles(source, 'game'), /Prepared audio differs/);
  await write(audioPath, audioBytes);
  assert.ok(!inventory.files.some((file) => file.endsWith('/delivery.png')));
  assert.ok(!inventory.files.some((file) => file.endsWith('/atlas.png')));
  await copySelectedFiles(source, path.join(root, 'output'), inventory);
  const first = Object.values(gameAssetCatalog)[0]!,
    delivery = path.posix.join(path.posix.dirname(first), 'delivery.png');
  const output = path.join(root, 'output');
  await assert.rejects(fs.access(path.join(output, delivery)), /ENOENT/);
  const reader = await builtAssetReader(output);
  try {
    assert.deepEqual(await reader.read(delivery), image);
  } finally {
    reader.dispose();
  }
  const emitted = await readJson(path.join(output, first));
  assert.deepEqual(
    emitted.pages[0].delivery.map((v: { encoding: string }) => v.encoding),
    ['png'],
  );
  assert.equal((await readJson(path.join(source, first))).pages[0].delivery.length, 2);
  await materializeBuiltAssets(output);
  assert.deepEqual(await fs.readFile(path.join(output, delivery)), image);
  const bundle = Object.keys(inventory.binary!)[0]!;
  await fs.writeFile(path.join(output, bundle), 'corrupt');
  const corrupt = await builtAssetReader(output);
  try {
    await assert.rejects(corrupt.read(delivery), /hash or size differs/);
  } finally {
    corrupt.dispose();
  }
  await write(delivery, 'corrupt');
  await assert.rejects(selectedFiles(source, 'game'), /Prepared delivery image differs/);
  await write(delivery, image);
  const manifest = await readJson(path.join(source, first));
  delete manifest.pages[0].delivery;
  await write(first, JSON.stringify(manifest));
  await assert.rejects(selectedFiles(source, 'game'), /ENOENT/);
  await write(path.posix.join(path.posix.dirname(first), 'atlas.png'), image);
  await assert.rejects(selectedFiles(source, 'game'), /Prepared page differs/);
});
