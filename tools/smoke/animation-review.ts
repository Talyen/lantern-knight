import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type {} from '../../src/inspection';

// Capture native framebuffers once. The gallery arranges them without host-side
// raster resampling or a second set of registration/timing calculations.
export async function captureAnimationReview(page: Page, output: string) {
  const plan = await page.evaluate(() => {
    const p = window.foundation.presentation;
    type Sample = {
      clip: string;
      heading: typeof p.labHeading;
      time: number;
      frame?: string;
      blend?: boolean;
      label: string;
    };
    const samples: Sample[] = [];
    for (const [clip, directions] of Object.entries(p.manifest.asset.clips))
      for (const heading of Object.keys(directions) as (typeof p.labHeading)[]) {
        const c = p.getClip(clip, heading),
          seen = new Set<string>();
        let elapsed = 0;
        for (const [i, frame] of c.frames.entries()) {
          if (!seen.has(frame))
            samples.push({
              clip,
              heading,
              time: elapsed + c.durationsMs[i]! / 2,
              frame,
              label: frame,
            });
          seen.add(frame);
          elapsed += c.durationsMs[i]!;
        }
      }
    const drawings = samples.length;
    for (const phase of [0.25, 0.75])
      for (const pair of p.animationFlow!.pairs.filter((pair) => pair.supported)) {
        const heading = pair.heading as typeof p.labHeading,
          c = p.getClip(pair.clip, heading);
        const index = c.frames.findIndex(
          (id, j) => id === pair.from && c.frames[(j + 1) % c.frames.length] === pair.to,
        );
        if (index < 0) throw new Error('Review transition is not adjacent in its clip');
        const hold = pair.holdFraction ?? 0;
        samples.push({
          clip: pair.clip,
          heading,
          blend: true,
          time:
            c.durationsMs.slice(0, index).reduce((a, b) => a + b, 0) +
            c.durationsMs[index]! * (hold + (1 - hold) * phase),
          label: `${pair.from} → ${pair.to} · ${phase}`,
        });
      }
    return { samples, drawings };
  });
  const gallery: string[] = [];
  for (const [i, sample] of plan.samples.entries()) {
    const bytes = await page.evaluate((sample) => {
      const f = window.foundation,
        p = f.presentation;
      p.labClip = sample.clip;
      p.labHeading = sample.heading;
      p.animationTreatment = 'guarded';
      p.stabilized = p.rigidSword = true;
      p.labAnimator.start(p.getClip(sample.clip, sample.heading));
      p.labAnimator.seek(sample.time);
      p.labTime = p.labAnimator.time;
      p.update(f.sim, 1, 0, { x: 0, z: 0 });
      if (sample.frame && p.labSprite.lastFrame !== sample.frame)
        throw new Error('Animation review skipped drawing: ' + sample.frame);
      if (sample.blend && !p.labSprite.lightingSample?.blend)
        throw new Error('Approved transition did not render');
      const copy = document.createElement('canvas');
      copy.width = p.canvas.width;
      copy.height = p.canvas.height;
      copy.getContext('2d')!.drawImage(p.canvas, 0, 0);
      return copy.toDataURL('image/png').split(',')[1]!;
    }, sample);
    const file = `animation-${i}.png`,
      label = sample.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    await fs.writeFile(path.join(output, file), Buffer.from(bytes, 'base64'));
    gallery.push(
      `<figure><a href="${file}"><img loading="lazy" src="${file}"></a><figcaption>${label}</figcaption></figure>`,
    );
  }
  await fs.writeFile(
    path.join(output, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Animation review</title><style>body{background:#151923;color:#ddd;font:16px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:12px}figure{margin:0}img{width:100%}</style><h1>Native drawings and guarded transitions</h1><p>Open any image for its original framebuffer dimensions.</p><main>${gallery.join('')}</main>`,
  );
  return plan.drawings;
}
