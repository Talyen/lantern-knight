import { stateTest as test, expect } from './fixtures';

test('covered artwork preparation preserves cropped pixels, shares lifetime cache and revokes it', async ({
  page,
}) => {
  await page.route('**/item-art-proof.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main></main>' }),
  );
  await page.goto('/item-art-proof.html');
  const result = await page.evaluate(async () => {
    const source = '/src/item-art.ts';
    const { createItemArtwork } = await import(source);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(180,100,60)';
    context.fillRect(2, 3, 8, 6);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    let requests = 0;
    const controller = new AbortController();
    const runtime = {
      catalog: new Proxy({}, { get: () => 'fixture/manifest.json' }),
      manifest: async () => ({
        frames: [{ page: 'page', rect: [0, 0, 16, 16] }],
        pages: [{ id: 'page', path: 'page.png', hash, width: 16, height: 16 }],
      }),
      imageRequest: async () => {
        requests++;
        return new Response(blob);
      },
    };
    const artwork = createItemArtwork(runtime, controller.signal);
    await artwork.prepare();
    const preparedRequests = requests;
    const shared = createItemArtwork(runtime, controller.signal);
    const a = artwork('gold'),
      b = shared('gold');
    document.body.append(a, b);
    await Promise.all(
      [a, b].map(
        (wrapper) =>
          new Promise<void>((resolve, reject) => {
            const wait = () => {
              if (wrapper.dataset.ready === 'true') resolve();
              else if (wrapper.dataset.ready === 'error') reject(new Error('Artwork failed'));
              else requestAnimationFrame(wait);
            };
            wait();
          }),
      ),
    );
    const image = a.querySelector('img')!;
    const output = document.createElement('canvas');
    output.width = image.naturalWidth;
    output.height = image.naturalHeight;
    output.getContext('2d')!.drawImage(image, 0, 0);
    const pixels = [...output.getContext('2d')!.getImageData(0, 0, 8, 6).data];
    const reused = requests === preparedRequests && image.src === b.querySelector('img')!.src;
    const revoke = URL.revokeObjectURL.bind(URL);
    const retired: string[] = [];
    URL.revokeObjectURL = (url) => {
      retired.push(url);
      revoke(url);
    };
    controller.abort();
    URL.revokeObjectURL = revoke;
    let rejected = false;
    try {
      artwork('gold');
    } catch {
      rejected = true;
    }
    return {
      shared: artwork === shared,
      reused,
      rejected,
      dimensions: [image.naturalWidth, image.naturalHeight],
      pixels,
      retired: retired.length,
      requests,
      preparedRequests,
    };
  });
  expect(result.shared && result.reused && result.rejected).toBe(true);
  expect(result.requests).toBe(result.preparedRequests);
  expect(result.retired).toBeGreaterThan(0);
  expect(result.dimensions).toEqual([8, 6]);
  expect(result.pixels).toEqual(Array.from({ length: 48 }, () => [180, 100, 60, 255]).flat());
});
