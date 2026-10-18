import { onExit } from '../../tools/scope-exit';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDelivery,
  TextureDelivery,
  type SourcePage,
} from '../../src/assets/texture-delivery';

test('delivery selects adequate full-composition variants, preserves source quality and respects GPU formats', () => {
  const variant = (width: number, height: number, encoding: 'png' | 'ktx2-uastc') => ({
    width,
    height,
    encoding,
    path: `${width}.${encoding}`,
    hash: 'a'.repeat(64),
    bytes: 10,
    gpuBytes: 20,
    mipmaps: true,
  });
  const page: SourcePage = {
    url: '/master.png',
    hash: 'b'.repeat(64),
    width: 6144,
    height: 4096,
    delivery: [
      variant(2040, 1360, 'png'),
      variant(2040, 1360, 'ktx2-uastc'),
      variant(4092, 2728, 'png'),
      variant(4092, 2728, 'ktx2-uastc'),
      variant(6144, 4096, 'png'),
      variant(6144, 4096, 'ktx2-uastc'),
    ],
  };
  // Runtime keeps native detail; mipmaps handle minification.
  assert.equal(selectDelivery(page, 8192, true, 'delivery').width, 6144);
  assert.equal(selectDelivery(page, 8192, false, 'delivery').encoding, 'png');
  assert.equal(selectDelivery(page, 8192, false, 'delivery').width, 6144);
  // Editor picking needs drawable PNGs, with native detail when supported and
  // a complete smaller composition on a GPU limited to 4096 pixels.
  const editorNative = selectDelivery(page, 8192, true, 'lossless');
  assert.equal(editorNative.width, 6144);
  assert.equal(editorNative.encoding, 'png');
  const editorLimited = selectDelivery(page, 4096, true, 'lossless');
  assert.equal(editorLimited.width, 4092);
  assert.equal(editorLimited.encoding, 'png');

  const original = selectDelivery(page, 8192, true, 'source');
  assert.equal(original.width, 6144);
  assert.equal(original.encoding, 'png');
  assert.equal(original.mipmaps, false);
  assert.throws(() => selectDelivery(page, 4096, true, 'source'), /original image exceeds/);
  const odd: SourcePage = {
    ...page,
    width: 2051,
    height: 1367,
    delivery: [variant(2051, 1367, 'png'), variant(2051, 1367, 'ktx2-uastc')],
  };
  assert.equal(selectDelivery(odd, 8192, true, 'delivery').encoding, 'png');
  assert.equal(selectDelivery(odd, 8192, true, 'delivery', false).encoding, 'ktx2-uastc');
});

test('strict browser policy uses lossless artwork without starting the eval-based Basis worker', () => {
  const page: SourcePage = {
    url: '/master.png',
    hash: 'a'.repeat(64),
    width: 512,
    height: 512,
    delivery: (['png', 'ktx2-uastc'] as const).map((encoding) => ({
      encoding,
      path: 'art.' + encoding,
      hash: 'a'.repeat(64),
      width: 512,
      height: 512,
      bytes: 10,
      gpuBytes: 20,
      mipmaps: false,
    })),
  };
  const gl = { MAX_TEXTURE_SIZE: 3379, getParameter: () => 8192, getExtension: () => ({}) };
  const canvas = {
    getContext: () => gl,
    ownerDocument: { querySelector: () => ({ content: "script-src 'self' 'wasm-unsafe-eval'" }) },
  } as unknown as HTMLCanvasElement;
  const delivery = new TextureDelivery(canvas);
  using _cleanup1 = onExit(() => delivery.dispose());
  assert.equal(delivery.choose(page).encoding, 'png');
  assert.equal(delivery.choose(page).width, 512);
});

test('delivery prepares a verified texture before transfer and closes failed uploads', async (t) => {
  const { mockGlobals } = await import('../fixtures/globals');
  let closed = 0,
    disposed = 0,
    prepared = 0;
  mockGlobals(t, {
    createImageBitmap: async () => ({ width: 2, height: 3, close: () => closed++ }),
  });
  const canvas = {
    getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => null }),
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLCanvasElement;
  const page = {
    url: '/test.png',
    hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    width: 2,
    height: 3,
  };
  const delivery = new TextureDelivery(
    canvas,
    'delivery',
    async () => new Response('abc'),
    (texture) => {
      prepared++;
      assert.equal(texture.colorSpace, 'srgb');
      assert.equal(texture.flipY, false);
      assert.equal(texture.premultiplyAlpha, false);
      assert.equal(texture.version, 1);
      texture.addEventListener('dispose', () => disposed++);
      if (prepared === 2) throw new Error('upload failed');
    },
  );
  using _cleanup3 = onExit(() => delivery.dispose());
  const texture = await delivery.decode(page);
  assert.equal(prepared, 1);
  assert.equal(closed, 0);
  await assert.rejects(delivery.decode(page), /upload failed/);
  assert.equal(closed, 1);
  assert.equal(disposed, 1);
  texture.dispose();
  (texture.image as ImageBitmap).close();
  assert.equal(closed, 2);
});

test('cancelled native bitmap decodes retain ownership until completion and never upload', async (t) => {
  const { mockGlobals } = await import('../fixtures/globals');
  const started = Promise.withResolvers<void>(),
    bitmap = Promise.withResolvers<ImageBitmap>(),
    controller = new AbortController();
  let closed = 0,
    uploaded = 0;
  mockGlobals(t, {
    createImageBitmap: () => {
      started.resolve();
      return bitmap.promise;
    },
  });
  const canvas = {
    getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => null }),
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLCanvasElement;
  const delivery = new TextureDelivery(
    canvas,
    'delivery',
    async () => new Response('abc'),
    () => {
      uploaded++;
    },
  );
  const pending = delivery.decode(
    {
      url: '/test.png',
      hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      width: 2,
      height: 3,
    },
    controller.signal,
  );
  const rejected = assert.rejects(pending, /cancelled/);
  using _cleanup2 = onExit(() => delivery.dispose());
  await started.promise;
  controller.abort(new Error('cancelled'));
  bitmap.resolve({
    width: 2,
    height: 3,
    close: () => {
      closed++;
    },
  } as ImageBitmap);
  await rejected;
  assert.equal(closed, 1);
  assert.equal(uploaded, 0);
});

test('compressed decode owns invalid textures and retires synchronous parser failures', async () => {
  const { Texture } = await import('three');
  const canvas = {
    getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => ({}) }),
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLCanvasElement;
  const delivery = new TextureDelivery(canvas, 'delivery', async () => new Response('abc'));
  using cleanup = onExit(() => delivery.dispose());
  const loader = Reflect.get(delivery, 'loader');
  const page = {
    url: '/test.ktx2',
    hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    width: 2,
    height: 3,
    encoding: 'ktx2-uastc' as const,
  };
  let disposed = 0,
    closed = 0;
  const texture = new Texture({ close: () => closed++ } as unknown as ImageBitmap);
  texture.addEventListener('dispose', () => disposed++);
  loader.parse = (_bytes: ArrayBuffer, loaded: (texture: InstanceType<typeof Texture>) => void) =>
    loaded(texture);
  await assert.rejects(delivery.decode(page), /no dimensions/);
  assert.equal(disposed, 1, 'Validation failure must destroy the staged compressed texture');
  assert.equal(closed, 1, 'Validation failure closes staged image ownership too');
  loader.parse = () => {
    throw new Error('parser initialization failed');
  };
  await assert.rejects(delivery.decode(page), /parser initialization failed/);
  assert.equal(Reflect.get(delivery, 'pending').size, 0, 'Failed parse retains no shutdown waiter');
  const initialization = Promise.withResolvers<void>();
  loader.transcoderPending = initialization.promise;
  let shutdowns = 0;
  loader.dispose = () => {
    if (++shutdowns === 1) throw new Error('worker shutdown failed');
  };
  assert.throws(() => delivery.dispose(), /worker shutdown failed/);
  initialization.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    shutdowns,
    2,
    'Initialization completing after failed shutdown still closes workers',
  );
});

test('compressed textures share the runtime configuration without generated mipmaps', async () => {
  const { Texture, SRGBColorSpace, LinearFilter } = await import('three');
  const canvas = {
    getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => ({}) }),
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLCanvasElement;
  const delivery = new TextureDelivery(canvas, 'delivery', async () => new Response('abc'));
  using cleanup = onExit(() => delivery.dispose());
  const loader = Reflect.get(delivery, 'loader');
  loader.parse = (_bytes: ArrayBuffer, loaded: (texture: InstanceType<typeof Texture>) => void) =>
    loaded(new Texture({ width: 2, height: 3, close: () => {} } as unknown as ImageBitmap));
  const held = await delivery.decode({
    url: '/test.ktx2',
    hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    width: 2,
    height: 3,
    encoding: 'ktx2-uastc' as const,
  });
  try {
    assert.equal(held.colorSpace, SRGBColorSpace);
    assert.equal(held.flipY, false);
    assert.equal(held.premultiplyAlpha, false);
    assert.equal(held.generateMipmaps, false);
    assert.equal(held.minFilter, LinearFilter);
    assert.equal(held.userData.delivery.encoding, 'ktx2-uastc');
  } finally {
    held.dispose();
    (held.image as { close?: () => void }).close?.();
  }
});

test('cancelled compressed transports stop before reading or transcoding obsolete bytes', async () => {
  const canvas = {
    getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => null }),
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLCanvasElement;
  for (const phase of ['response', 'body']) {
    const controller = new AbortController();
    let reads = 0;
    const delivery = new TextureDelivery(canvas, 'delivery', async () => {
      if (phase === 'response') controller.abort(new Error('obsolete response'));
      return Object.assign(new Response('abc'), {
        arrayBuffer: async () => {
          reads++;
          controller.abort(new Error('obsolete body'));
          return new TextEncoder().encode('abc').buffer;
        },
      });
    });
    using cleanup = onExit(() => delivery.dispose());
    await assert.rejects(
      delivery.decode(
        {
          url: '/page.ktx2',
          encoding: 'ktx2-uastc',
          hash: 'wrong',
          width: 2,
          height: 3,
        },
        controller.signal,
      ),
      /obsolete/,
    );
    assert.equal(reads, phase === 'response' ? 0 : 1);
  }
});
