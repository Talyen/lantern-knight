import { pixelTest as test, expect } from './fixtures';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fixture from '../fixtures/image-delivery.json';

test('GPU image delivery preserves full composition and orientation against the lossless source', async ({
  page,
}) => {
  await page.route('**/delivery-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas width="64" height="64"></canvas>' }),
  );
  for (const [name, record] of Object.entries(fixture))
    await page.route('**/proof-' + name, (route) =>
      route.fulfill({ body: Buffer.from(record.base64, 'base64') }),
    );
  for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    const bytes = await fs.readFile(
      fileURLToPath(
        new URL('../libs/basis/' + name, import.meta.resolve('three/addons/loaders/KTX2Loader.js')),
      ),
    );
    await page.route('**/decoders/' + name, (route) =>
      route.fulfill({
        body: bytes,
        contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      }),
    );
  }
  await page.goto('/delivery-proof.html');
  const proof = await page.evaluate(
    async (hashes) => {
      const threePath = '/node_modules/.vite/deps/three.js',
        deliveryPath = '/src/assets/texture-delivery.ts';
      const T = await import(threePath),
        { TextureDelivery } = await import(deliveryPath);
      const canvas = document.querySelector('canvas')!;
      const delivery = new TextureDelivery(canvas);
      const renderer = new T.WebGLRenderer({ canvas, alpha: false, antialias: false });
      renderer.setSize(64, 64);
      const target = new T.WebGLRenderTarget(64, 64),
        scene = new T.Scene(),
        camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.z = 1;
      const geometry = new T.PlaneGeometry(2, 2),
        material = new T.MeshBasicMaterial({ toneMapped: false });
      scene.add(new T.Mesh(geometry, material));
      const render = async (name: string, encoding: 'png' | 'ktx2-uastc') => {
        const texture = await delivery.decode({
          url: '/proof-' + name,
          hash: hashes[name as keyof typeof hashes],
          width: 64,
          height: 64,
          encoding,
          mipmaps: false,
        });
        material.map = texture;
        material.needsUpdate = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(64 * 64 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
        texture.dispose();
        return pixels;
      };
      try {
        const source = await render('source', 'png'),
          compressed = await render('compressed', 'ktx2-uastc');
        return {
          difference: Math.max(
            ...source.map((value, index) => Math.abs(value - compressed[index]!)),
          ),
          // gl.readPixels starts at the bottom. These distinct source quadrants
          // reject blank/no-draw parity as well as a shared orientation error.
          corners: [
            [0, 0],
            [63, 0],
            [0, 63],
            [63, 63],
          ].map(([x, y]) =>
            Array.from(source.subarray((y! * 64 + x!) * 4, (y! * 64 + x!) * 4 + 4)),
          ),
        };
      } finally {
        delivery.dispose();
        geometry.dispose();
        material.dispose();
        target.dispose();
        renderer.dispose();
      }
    },
    { source: fixture.source.hash, compressed: fixture.compressed.hash },
  );
  // The offscreen target stores linear RGB; these are the decoded sRGB source quadrants.
  for (const [index, expected] of [
    [2, 5, 26, 255],
    [2, 164, 26, 255],
    [202, 5, 26, 255],
    [202, 164, 26, 255],
  ].entries())
    for (const [channel, value] of expected.entries())
      expect(Math.abs(proof.corners[index]![channel]! - value)).toBeLessThanOrEqual(1);
  expect(proof.difference).toBeLessThanOrEqual(3);
});
