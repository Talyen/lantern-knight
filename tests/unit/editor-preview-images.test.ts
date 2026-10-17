import { it } from 'node:test';
import assert from 'node:assert/strict';
import { PreviewImages } from '../../src/editor/preview-images';

function fixture() {
  const requests: {
    source: string;
    resolve: (image: HTMLImageElement) => void;
    reject: (error: Error) => void;
    cancelled: boolean;
  }[] = [];
  const images = new PreviewImages((source, signal) => {
    const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
    const request = { source, resolve, reject, cancelled: false };
    requests.push(request);
    signal.addEventListener(
      'abort',
      () => {
        request.cancelled = true;
        request.reject(new Error('cancelled'));
      },
      { once: true },
    );
    return promise;
  });
  const target = () => ({ isConnected: true }) as HTMLCanvasElement;
  const image = { naturalWidth: 16, naturalHeight: 16 } as HTMLImageElement;
  const flush = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return { images, requests, target, image, flush };
}

it('only the latest preview may paint a reused canvas, with shared page loads across targets', async () => {
  const f = fixture(),
    canvas = f.target(),
    painted: string[] = [];
  const old = f.images.draw(canvas, 'old', () => painted.push('old'));
  const peer = f.images.draw(f.target(), 'old', () => painted.push('peer'));
  const current = f.images.draw(canvas, 'new', () => painted.push('new'));
  await f.flush();
  assert.deepEqual(
    f.requests.map((r) => r.source),
    ['old', 'new'],
  );
  f.requests[1]!.resolve(f.image);
  await current;
  f.requests[0]!.resolve(f.image);
  await Promise.all([old, peer]);
  assert.deepEqual(painted, ['new', 'peer']);
  await f.images.draw(canvas, 'new', () => painted.push('cached'));
  assert.equal(f.requests.length, 2);
  assert.equal(painted.at(-1), 'cached');
  f.images.dispose();
});

it('bounds concurrent decoding and closes active and queued work without late paints', async () => {
  const f = fixture();
  let paints = 0;
  const work = Array.from({ length: 20 }, (_, i) =>
    f.images.draw(f.target(), String(i), () => paints++),
  );
  await f.flush();
  assert.equal(f.requests.length, 6);
  f.requests[0]!.resolve(f.image);
  await f.flush();
  assert.equal(f.requests.length, 7);
  assert.equal(paints, 1);
  // A transport that ignores cancellation must not retain a mounted caller.
  f.requests[1]!.reject = () => {};
  f.images.dispose();
  f.images.dispose();
  await Promise.all(work);
  assert.equal(
    f.requests.slice(1).every((r) => r.cancelled),
    true,
  );
  assert.equal(paints, 1);
  await f.images.draw(f.target(), 'after disposal', () => paints++);
  assert.equal(f.requests.length, 7);
});

it('failed pages remain retryable and detached canvases cannot receive delayed paints', async () => {
  const f = fixture(),
    canvas = f.target();
  let paints = 0;
  const first = f.images.draw(canvas, 'retry', () => paints++);
  await f.flush();
  f.requests[0]!.reject(new Error('offline'));
  await assert.rejects(first, /offline/);
  await f.flush();
  const retry = f.images.draw(canvas, 'retry', () => paints++);
  await f.flush();
  assert.equal(f.requests.length, 2);
  Object.assign(canvas, { isConnected: false });
  f.requests[1]!.resolve(f.image);
  await retry;
  assert.equal(paints, 0);
  const detached = f.images.draw(canvas, 'detached', () => paints++);
  await f.flush();
  const requests = f.requests.length;
  f.images.dispose();
  await detached;
  assert.equal(requests, 2, 'detached canvases do not start another decode');
});

it('evicts decoded atlas pixels by memory budget rather than only counting page URLs', async () => {
  const f = fixture();
  const atlas = { naturalWidth: 4096, naturalHeight: 4096 } as HTMLImageElement;
  const canvas = f.target();
  const first = f.images.draw(canvas, 'first', () => {});
  await f.flush();
  f.requests[0]!.resolve(atlas);
  await first;
  const second = f.images.draw(f.target(), 'second', () => {});
  await f.flush();
  f.requests[1]!.resolve(atlas);
  await second;
  // The painted canvas stays mounted while users scroll through the palette.
  const reload = f.images.draw(canvas, 'first', () => {});
  await f.flush();
  assert.equal(f.requests.length, 3);
  f.requests[2]!.resolve(atlas);
  await reload;
  f.images.dispose();
});

it('leases oversized animation pages only until playback closes and rejects late paints', async () => {
  const f = fixture(),
    canvas = f.target(),
    playback = f.images.playback(canvas),
    atlas = { naturalWidth: 8192, naturalHeight: 8192 } as HTMLImageElement;
  let paints = 0;
  const first = playback.draw('oversized', () => paints++);
  await f.flush();
  f.requests[0]!.resolve(atlas);
  await first;
  await playback.draw('oversized', () => paints++);
  assert.equal(f.requests.length, 1);
  assert.equal(paints, 2);

  const pending = playback.draw('next-page', () => paints++);
  await f.flush();
  playback.dispose();
  playback.dispose();
  await playback.draw('closed', () => paints++);
  f.requests[1]!.resolve(atlas);
  await pending;
  assert.equal(paints, 2);

  // Neither a new playback nor the still-mounted canvas owns the closed lease.
  const reopened = f.images.playback(canvas);
  const reload = reopened.draw('oversized', () => paints++);
  await f.flush();
  assert.equal(f.requests.length, 3);
  f.requests[2]!.resolve(atlas);
  await reload;
  assert.equal(paints, 3);
  f.images.dispose();
  await reopened.draw('oversized', () => paints++);
  assert.equal(paints, 3);
  assert.equal(f.requests.length, 3);
});

it('replacing canvases and closing playback retire unshared work without waiting for transport', async () => {
  const f = fixture(),
    canvas = f.target();
  const old = f.images.draw(canvas, 'obsolete', () => assert.fail('obsolete paint'));
  await f.flush();
  f.requests[0]!.reject = () => {};
  const current = f.images.draw(canvas, 'current', () => {});
  await f.flush();
  assert.equal(f.requests[0]!.cancelled, true);
  await old;
  f.requests[1]!.resolve(f.image);
  await current;
  const playback = f.images.playback(canvas);
  const pending = playback.draw('closed', () => assert.fail('closed paint'));
  await f.flush();
  playback.dispose();
  await pending;
  assert.equal(f.requests[2]!.cancelled, true);
  const reopened = f.images.draw(canvas, 'closed', () => {});
  await f.flush();
  assert.equal(f.requests.length, 4);
  f.requests[2]!.resolve(f.image);
  f.requests[3]!.resolve(f.image);
  await reopened;
  f.images.dispose();
});

it('retiring queued previews starts only their current successors and keeps shared readers alive', async () => {
  const f = fixture();
  const canvases = Array.from({ length: 12 }, () => f.target());
  const stale = canvases.map((canvas, i) => f.images.draw(canvas, 'old-' + i, () => {}));
  await f.flush();
  const peer = f.images.draw(f.target(), 'old-0', () => {});
  const latest = canvases.map((canvas, i) => f.images.draw(canvas, 'new-' + i, () => {}));
  await f.flush();
  assert.equal(f.requests[0]!.cancelled, false, 'A surviving reader owns the shared load');
  assert.equal(
    f.requests.some((r) => r.source === 'old-6'),
    false,
  );
  f.requests[0]!.resolve(f.image);
  await peer;
  await f.flush();
  for (let i = 0; i < 3; i++) {
    for (const request of f.requests)
      if (request.source.startsWith('new-')) request.resolve(f.image);
    await f.flush();
  }
  await Promise.all([...stale, ...latest]);
  assert.equal(f.requests.filter((r) => r.source.startsWith('new-')).length, 12);
  assert.equal(
    f.requests.some((r) => /^old-(6|7|8|9|10|11)$/.test(r.source)),
    false,
  );
  f.images.dispose();
});

it('a pending animation source survives repeated frame requests on the same canvas', async () => {
  const f = fixture(),
    canvas = f.target();
  let paints = 0;
  const old = f.images.draw(canvas, 'shared', () => assert.fail('old paint'));
  await f.flush();
  const latest = f.images.draw(canvas, 'shared', () => paints++);
  await old;
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]!.cancelled, false);
  f.requests[0]!.resolve(f.image);
  await latest;
  assert.equal(paints, 1);
  f.images.dispose();
});
