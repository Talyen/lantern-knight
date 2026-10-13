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
  const images = new PreviewImages((source) => {
    let resolve!: (image: HTMLImageElement) => void, reject!: (error: Error) => void;
    const promise = new Promise<HTMLImageElement>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    const request = { source, resolve, reject, cancelled: false };
    requests.push(request);
    return {
      promise,
      cancel: () => {
        request.cancelled = true;
        reject(new Error('cancelled'));
      },
    };
  });
  const target = () => ({ isConnected: true }) as HTMLCanvasElement;
  const image = { naturalWidth: 16, naturalHeight: 16 } as HTMLImageElement;
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
  f.images.dispose();
});

it('evicts decoded atlas pixels by memory budget rather than only counting page URLs', async () => {
  const f = fixture();
  const atlas = { naturalWidth: 4096, naturalHeight: 4096 } as HTMLImageElement;
  const first = f.images.draw(f.target(), 'first', () => {});
  await f.flush();
  f.requests[0]!.resolve(atlas);
  await first;
  const second = f.images.draw(f.target(), 'second', () => {});
  await f.flush();
  f.requests[1]!.resolve(atlas);
  await second;
  const reload = f.images.draw(f.target(), 'first', () => {});
  await f.flush();
  assert.equal(f.requests.length, 3);
  f.requests[2]!.resolve(atlas);
  await reload;
  f.images.dispose();
});

it('reuses a displayed oversized page across animation frames without retaining removed canvases', async () => {
  const f = fixture(),
    canvas = f.target();
  const first = f.images.draw(canvas, 'oversized', () => {});
  await f.flush();
  f.requests[0]!.resolve({ naturalWidth: 8192, naturalHeight: 8192 } as HTMLImageElement);
  await first;
  await f.images.draw(canvas, 'oversized', () => {});
  assert.equal(f.requests.length, 1);
  f.images.dispose();
});
