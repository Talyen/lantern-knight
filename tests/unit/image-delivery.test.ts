import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createPreparationContext } from '../../tools/assets/context';
import { prepareImageDelivery, imageHash } from '../../tools/assets/image-delivery';

test('quick preparation preserves source bytes, alpha and cached derivatives without invoking a GPU encoder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-delivery-unit-'));
  const context = await createPreparationContext({
    workspace: root,
    budget: 1024 ** 2,
    sourceRoot: root,
    libraryRoot: root,
    environment: { ...process.env, LANTERN_IMAGE_GPU: '1', LANTERN_KTX: '/no-encoder-is-needed' },
  });
  try {
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
    assert.deepEqual(
      await fs.readFile(path.join(root, 'public', cooked.delivery[0]!.path)),
      source,
    );
    context.environment.LANTERN_IMAGE_GPU = '0';
    const reused = await prepareImageDelivery(context, source, page, false, true);
    assert.deepEqual(reused, cooked);
    await fs.writeFile(path.join(root, 'public', cooked.delivery[0]!.path), 'changed bytes');
    await assert.rejects(prepareImageDelivery(context, source, page, false, true));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
