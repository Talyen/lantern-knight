import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparationContext } from '../../tools/assets/context';
import {
  prepareImageDelivery,
  imageHash,
  useGpuCompression,
} from '../../tools/assets/image-delivery';

test('GPU compression applies to opaque aligned artwork above the size floor', () => {
  assert.equal(useGpuCompression(true, 640, 640), false);
  assert.equal(useGpuCompression(false, 6144, 4096), true);
  assert.equal(useGpuCompression(false, 1254, 1254), false);
  assert.equal(useGpuCompression(false, 1672, 941), false);
  assert.equal(useGpuCompression(false, 2, 2), true);
});

test('quick preparation preserves source bytes, alpha and cached derivatives without invoking a GPU encoder', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-delivery-unit-');
  const context = await createPreparationContext({
    workspace: root,
    budget: 1024 ** 2,
    sourceRoot: root,
    libraryRoot: root,
    environment: { ...process.env, LANTERN_IMAGE_GPU: '1', LANTERN_KTX: '/no-encoder-is-needed' },
  });

  const source = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 80, g: 130, b: 20, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const page = {
    id: 'page',
    path: 'source.png',
    width: 16,
    height: 16,
    hash: imageHash(source),
    bytes: source.length,
    rgbaBytes: 16 * 16 * 4,
    mipmaps: false,
    extrusion: 0,
    gutter: 0,
  };
  const cooked = await prepareImageDelivery(context, source, page, false, false);
  assert.equal(cooked.decisions[0]!.reason, 'lossless-alpha');
  assert.equal(cooked.delivery[0]!.hash, page.hash);
  assert.deepEqual(await fs.readFile(path.join(root, 'public', cooked.delivery[0]!.path)), source);
  context.environment.LANTERN_IMAGE_GPU = '0';
  const reused = await prepareImageDelivery(context, source, page, false, true);
  assert.deepEqual(reused, cooked);
  await fs.writeFile(path.join(root, 'public', cooked.delivery[0]!.path), 'changed bytes');
  await assert.rejects(prepareImageDelivery(context, source, page, false, true));
});
