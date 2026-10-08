import sharp from 'sharp';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { smokeLaunch } from './smoke-launch';
import '../src/inspection';
const run = await smokeLaunch(true, [], { budget: 256 * 1024 ** 2 });
try {
  const { page, output } = run;
  await page.waitForFunction(() => window.foundation?.ready, {}, { timeout: 60000 });
  await page.getByRole('button', { name: 'Compare animation', exact: true }).click();
  await page.locator('#play').click();
  const report = await page.evaluate(() => {
    const p = window.foundation.presentation,
      m = p.manifest,
      observations = [];
    p.debug = false;
    p.labPaused = true;
    for (const [name, dirs] of Object.entries(m.asset.clips))
      for (const heading of Object.keys(dirs)) {
        p.labClip = name;
        p.labHeading = heading as typeof p.labHeading;
        const clip = p.getClip(name, p.labHeading);
        p.labAnimator.start(clip);
        let time = 0;
        for (let i = 0; i < clip.frames.length; i++) {
          for (const phase of [0.05, 0.4, 0.95]) {
            p.labAnimator.seek(time + clip.durationsMs[i]! * phase);
            p.labTime = p.labAnimator.time;
            for (const mode of ['original', 'guarded'] as const) {
              p.animationTreatment = mode;
              p.update(window.foundation.sim, 1, 0, { x: 0, z: 0 });
              const sprite = p.labSprite;
              if (!clip.frames.includes(sprite.lastFrame))
                throw new Error('comparison frame escaped current clip');
              if (
                !Array.from(sprite.geometry.getAttribute('position').array).every(Number.isFinite)
              )
                throw new Error('nonfinite registered geometry');
            }
          }
          time += clip.durationsMs[i]!;
        }
        observations.push({ name, heading, frames: clip.frames.length });
      }
    return {
      observations,
      pairs: p.animationFlow!.pairs.length,
      guarded: p.animationFlow!.pairs.filter((v) => v.supported).length,
    };
  });
  assert.equal(report.observations.length, 40);
  assert.deepEqual(run.errors, []);
  if (run.capture) {
    const clips = await page.evaluate(() =>
      Object.keys(window.foundation.presentation.manifest.asset.clips),
    );
    for (const name of clips) {
      const tiles: { input: Buffer; left: number; top: number }[] = [];
      const dirs = await page.evaluate(
        (name) => Object.keys(window.foundation.presentation.manifest.asset.clips[name]!),
        name,
      );
      for (const [row, heading] of dirs.entries())
        for (const [column, phase] of [0.1, 0.35, 0.6, 0.85].entries()) {
          const bytes = await page.evaluate(
            ({ name, heading, phase }) => {
              const f = window.foundation,
                p = f.presentation;
              p.labClip = name;
              p.labHeading = heading as typeof p.labHeading;
              p.animationTreatment = 'guarded';
              p.stabilized = true;
              p.rigidSword = true;
              const c = p.getClip(name, p.labHeading),
                duration = c.durationsMs.reduce((a, b) => a + b, 0);
              p.labAnimator.start(c);
              p.labAnimator.seek(duration * phase);
              p.labTime = p.labAnimator.time;
              p.update(f.sim, 1, 0, { x: 0, z: 0 });
              const copy = document.createElement('canvas');
              copy.width = p.canvas.width;
              copy.height = p.canvas.height;
              copy.getContext('2d')!.drawImage(p.canvas, 0, 0);
              return copy.toDataURL('image/png').split(',')[1]!;
            },
            { name, heading, phase },
          );
          const input = await sharp(Buffer.from(bytes, 'base64'))
            .resize(560, 320, { fit: 'contain', background: '#151923' })
            .png()
            .toBuffer();
          tiles.push({ input, left: column * 560, top: row * 320 });
        }
      await sharp({
        create: { width: 2240, height: dirs.length * 320, channels: 4, background: '#151923' },
      })
        .composite(tiles)
        .png()
        .toFile(path.join(output, `${name}-comparison.png`));
    }
    const approved = await page.evaluate(() =>
      window.foundation.presentation
        .animationFlow!.pairs.filter((p) => p.supported)
        .map((p) => ({
          clip: p.clip,
          heading: p.heading,
          from: p.from,
          to: p.to,
          holdFraction: p.holdFraction ?? 0,
        })),
    );
    for (const phase of [0.25, 0.75]) {
      const tiles: { input: Buffer; left: number; top: number }[] = [],
        labels: string[] = [];
      for (const [i, pair] of approved.entries()) {
        const bytes = await page.evaluate(
          ({ pair, phase }) => {
            const f = window.foundation,
              p = f.presentation;
            p.labClip = pair.clip;
            p.labHeading = pair.heading as typeof p.labHeading;
            p.animationTreatment = 'guarded';
            p.stabilized = true;
            p.rigidSword = true;
            const c = p.getClip(p.labClip, p.labHeading),
              index = c.frames.findIndex(
                (id, i) => id === pair.from && c.frames[(i + 1) % c.frames.length] === pair.to,
              ),
              time =
                c.durationsMs.slice(0, index).reduce((a, b) => a + b, 0) +
                c.durationsMs[index]! * (pair.holdFraction + (1 - pair.holdFraction) * phase);
            p.labAnimator.start(c);
            p.labAnimator.seek(time);
            p.labTime = time;
            p.update(f.sim, 1, 0, { x: 0, z: 0 });
            if (!p.labSprite.lightingSample?.blend)
              throw new Error('Approved transition did not render');
            const copy = document.createElement('canvas');
            copy.width = p.canvas.width;
            copy.height = p.canvas.height;
            copy.getContext('2d')!.drawImage(p.canvas, 0, 0);
            return copy.toDataURL('image/png').split(',')[1]!;
          },
          { pair, phase },
        );
        const left = (i % 5) * 480,
          top = Math.floor(i / 5) * 300;
        tiles.push({
          input: await sharp(Buffer.from(bytes, 'base64')).resize(480, 280).png().toBuffer(),
          left,
          top: top + 20,
        });
        labels.push(
          `<text x="${left + 8}" y="${top + 15}" fill="#ddd" font-size="12">${pair.from} → ${pair.to}</text>`,
        );
      }
      const width = 2400,
        height = Math.ceil(approved.length / 5) * 300;
      tiles.push({
        input: Buffer.from(`<svg width="${width}" height="${height}">${labels.join('')}</svg>`),
        left: 0,
        top: 0,
      });
      await sharp({ create: { width, height, channels: 4, background: '#151923' } })
        .composite(tiles)
        .png()
        .toFile(path.join(output, `guarded-${phase}.png`));
    }
    await fs.writeFile(path.join(output, 'animation-review.json'), JSON.stringify(report, null, 2));
    console.log('Visual review: ' + output);
  }
  console.log(
    `PASS: ${report.observations.length} current clips/directions, held/guarded playback; ${report.guarded}/${report.pairs} guarded candidates.`,
  );
} catch (error) {
  await fs.writeFile(
    path.join(run.output, 'animation-failure.json'),
    JSON.stringify({ error: String(error), errors: run.errors }),
  );
  throw error;
} finally {
  await run.close();
}
