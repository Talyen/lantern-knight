import { test, expect } from './fixtures';

test('prepared samples decode, mute persists, and Preview exposes every audition', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = { starts: 0, stops: 0, loopStarts: 0 };
    Object.assign(window, { audioProbe: probe });
    // oxlint-disable-next-line typescript/unbound-method -- Preserve the original prototype method and call it with the live context.
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this),
        start = source.start.bind(source),
        stop = source.stop.bind(source);
      source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
        probe.starts++;
        if (source.loop) probe.loopStarts++;
        start(...args);
      };
      source.stop = (...args: Parameters<AudioBufferSourceNode['stop']>) => {
        probe.stops++;
        stop(...args);
      };
      return source;
    };
  });
  const requested: string[] = [];
  page.on('request', (request) => {
    if (/\/audio\//.test(request.url())) requested.push(request.url());
  });
  await page.goto('/index.html');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#pause').click();
  await expect(page.locator('[data-audio="master"]')).toHaveValue('80');
  await page.locator('[data-audio="master"]').fill('35');
  await page.locator('[data-audio="muted"]').check();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((key) => key.endsWith('-settings'));
        return key ? JSON.parse(localStorage.getItem(key)!).audio : undefined;
      }),
    )
    .toEqual({ master: 0.35, effects: 0.8, ambience: 0.65, muted: true });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#pause').click();
  await expect(page.locator('[data-audio="master"]')).toHaveValue('35');
  await expect(page.locator('[data-audio="muted"]')).toBeChecked();
  await page.locator('[data-audio="muted"]').uncheck();
  await page.locator('#resume').click();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { audioProbe: { starts: number } }).audioProbe.starts,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { audioProbe: { loopStarts: number } }).audioProbe.loopStarts,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => requested.filter((url) => url.endsWith('.wav')).length)
    .toBeGreaterThan(0);

  // Decode every shipped sample through the browser's actual decoder. Report
  // peak/RMS metrics without claiming a human listening approval.
  const decoded = await page.evaluate(async () => {
    const manifest = await (await fetch('/audio/manifest.json')).json();
    const context = new AudioContext();
    const records = [];
    try {
      for (const sample of manifest.samples) {
        const bytes = await (await fetch('/' + sample.path)).arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        let peak = 0,
          squared = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const values = buffer.getChannelData(channel);
          for (const value of values) {
            peak = Math.max(peak, Math.abs(value));
            squared += value * value;
          }
        }
        records.push({
          id: sample.id,
          duration: buffer.duration,
          channels: buffer.numberOfChannels,
          peak,
          rms: Math.sqrt(squared / (buffer.length * buffer.numberOfChannels)),
        });
      }
    } finally {
      await context.close();
    }
    return records;
  });
  expect(decoded).toHaveLength(60);
  for (const sample of decoded) {
    expect(sample.duration, sample.id).toBeGreaterThan(0.01);
    expect(sample.peak, sample.id).toBeLessThanOrEqual(1);
    expect(sample.rms, sample.id).toBeGreaterThan(0);
  }
  await test.info().attach('audio-decoding-metrics', {
    body: JSON.stringify(decoded, null, 2),
    contentType: 'application/json',
  });
  await page.goto('/sandbox.html?scene=outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.locator('[data-panel="inspect"]').click();
  const select = page.getByLabel('Prepared audio sample');
  await expect(select.locator('option')).toHaveCount(60);
  await select.selectOption('sword-1');
  await page.getByRole('button', { name: 'Play sample', exact: true }).click();
  await page.getByRole('button', { name: 'Stop sample', exact: true }).click();
  await page.locator('[data-audio="muted"]').check();
  await page.reload();
  await page.waitForFunction(() => window.foundation?.ready);
  await page.locator('[data-panel="inspect"]').click();
  await expect(page.locator('[data-audio="muted"]')).toBeChecked();
});
