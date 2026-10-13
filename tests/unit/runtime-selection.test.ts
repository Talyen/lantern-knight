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
  await write('lighting/manifest.json', JSON.stringify({ entries: {} }));
  await write('visual-effects/surfaces.json', JSON.stringify({ entries: {} }));
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
    await write(file, JSON.stringify(manifest));
    await write(delivery, image);
  }
  const inventory = await selectedFiles(source, 'game');
  assert.ok(inventory.files.some((file) => file.endsWith('/delivery.png')));
  assert.ok(!inventory.files.some((file) => file.endsWith('/atlas.png')));
  await copySelectedFiles(source, path.join(root, 'output'), inventory);
  const first = Object.values(gameAssetCatalog)[0]!,
    delivery = path.posix.join(path.posix.dirname(first), 'delivery.png');
  assert.deepEqual(await fs.readFile(path.join(root, 'output', delivery)), image);
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
