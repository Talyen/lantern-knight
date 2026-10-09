import assert from 'node:assert/strict';
import path from 'node:path';
import { extractFile } from '@electron/asar';
import type { smokeLaunch } from './smoke-launch';
import { observeWork } from './smoke-launch';
import { loadingVideoPath } from '../../src/content/loading-media';
import { validateLoadingVideo } from '../assets/loading-media';

// Reuse the existing Game/Sandbox journey and profile; no additional app launch.
export async function checkLoadingScreen(
  run: Awaited<ReturnType<typeof smokeLaunch>>,
  dev: boolean,
) {
  const { page, app } = run;
  const archive =
    process.platform === 'darwin'
      ? path.resolve(path.dirname(run.executable), '../Resources/app.asar')
      : path.join(path.dirname(run.executable), 'resources/app.asar');
  validateLoadingVideo(extractFile(archive, `${dev ? 'dist-dev' : 'dist'}/${loadingVideoPath}`));
  await page.addInitScript(() => {
    Reflect.set(window, '__name', (fn: Function) => fn);
    if (sessionStorage.getItem('loading-proof-started')) return;
    sessionStorage.setItem('loading-proof-started', 'true');
    const request = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const resource =
        args[0] instanceof Request ? args[0].url : args[0] instanceof URL ? args[0].href : args[0];
      if (resource.endsWith('/build-mode.json')) {
        await new Promise<void>((resolve) => Reflect.set(window, 'releaseLoadingProof', resolve));
      }
      return request(...args);
    };
  });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    if (!window.isVisible()) window.showInactive();
  });
  await page.reload();
  await page.waitForFunction(
    () => typeof Reflect.get(window, 'releaseLoadingProof') === 'function',
  );
  const screen = page.locator('#loading-screen');
  assert.equal(await screen.isVisible(), true);
  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#loading-screen video')!;
    return video.readyState >= 2 && video.currentTime > 0.15 && video.muted && video.loop;
  });
  if (run.capture) {
    // Review a decoded frame after the supplied opening reveal, before its closing reveal.
    await page.locator('#loading-screen video').evaluate((element) => {
      const video = element as HTMLVideoElement;
      const target = video.duration / 2;
      return new Promise<void>((resolve, reject) => {
        const frame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          if (Math.abs(metadata.mediaTime - target) > 0.1) {
            video.requestVideoFrameCallback(frame);
            return;
          }
          video.pause();
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 18;
          const context = canvas.getContext('2d')!;
          context.drawImage(video, 0, 0, 32, 18);
          const pixels = context.getImageData(0, 0, 32, 18).data;
          let painted = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 60) painted++;
          if (painted < 32 * 18 * 0.2) {
            reject(new Error('Loading capture lacks the decoded composition'));
            return;
          }
          resolve();
        };
        // Register before seeking; a queued pre-seek frame cannot certify the destination.
        video.requestVideoFrameCallback(frame);
        video.currentTime = target;
      });
    });
  }
  const originalSize = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getContentSize(),
  );
  for (const [width, height] of [
    [1280, 800],
    [1600, 700],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0]!.setContentSize(size.width!, size.height!),
      { width, height },
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    assert.deepEqual(
      await screen.evaluate((el) => {
        const video = el.querySelector('video')!;
        return [video.videoWidth, video.videoHeight, getComputedStyle(video).objectFit];
      }),
      [1920, 1080, 'contain'],
    );
    if (run.capture) await page.screenshot({ path: path.join(run.output, `loading-${width}.png`) });
  }
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!),
    originalSize,
  );
  if (run.capture)
    await page
      .locator('#loading-screen video')
      .evaluate((element) => (element as HTMLVideoElement).play());
  await page.keyboard.press('Escape');
  assert.equal(await screen.isVisible(), true, 'Escape must not dismiss pending loading');
  assert.equal(
    await page.locator('#modal').isVisible(),
    false,
    'Loading keys must not open the pause menu',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () => document.querySelector<HTMLVideoElement>('#loading-screen video')!.paused,
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(
    () => !document.querySelector<HTMLVideoElement>('#loading-screen video')!.paused,
  );
  // Exercise the same recovery path raised by media/decode errors without changing packaged bytes.
  await page.locator('#loading-screen video').dispatchEvent('error');
  assert.equal(await screen.getAttribute('data-failed'), 'true');
  assert.equal(await screen.isVisible(), true, 'Failed playback must retain the loading indicator');
  await page.evaluate(() => (Reflect.get(window, 'releaseLoadingProof') as () => void)());
  await screen.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  if (dev) await observeWork(page);
  assert.equal(
    await page.locator('#loading-screen video').evaluate((el) => (el as HTMLVideoElement).paused),
    true,
  );
  // Observe subsequent real room loads after the controlled startup check.
  await page.evaluate(() => {
    const screen = document.querySelector('#loading-screen')!;
    const history: boolean[] = [];
    Reflect.set(window, 'loadingProofHistory', history);
    new MutationObserver(() => history.push((screen as HTMLDialogElement).open)).observe(screen, {
      attributes: true,
      attributeFilter: ['open'],
    });
  });
  console.log(
    `${dev ? 'Sandbox' : 'Game'} loading: packaged video advances, contains its native composition, blocks input and survives playback failure.`,
  );
}
