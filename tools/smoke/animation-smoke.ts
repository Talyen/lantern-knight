import { captureAnimationReview } from './animation-review';
import { scenario } from './scenario';
import '../../src/inspection';

export async function runScenario(flags: string[] = []) {
  await scenario(
    true,
    flags,
    async (run) => {
      const { page, output } = run;
      await page.getByRole('button', { name: 'Animation', exact: true }).click();
      await page.getByText('Comparison & treatment', { exact: true }).click();
      await page.locator('#walk-compare').click();
      await page.locator('#pause').click();
      const report = await page.evaluate(() => {
        const p = window.foundation.presentation,
          observations = [];
        p.debug = false;
        p.labPaused = true;
        const flow = p.animationFlow!;
        const supported = flow.pairs.filter((pair) => pair.supported);
        const representatives = [
          supported.find((pair) => pair.weaponVisibility === 'visible'),
          supported.find((pair) => pair.weaponVisibility === 'hidden'),
        ];
        if (representatives.some((pair) => !pair))
          throw new Error('Required visible/hidden weapon transition unavailable');
        for (const pair of representatives) {
          p.labClip = pair!.clip;
          p.labHeading = pair!.heading as typeof p.labHeading;
          const clip = p.getClip(p.labClip, p.labHeading);
          const index = clip.frames.findIndex(
            (id, i) => id === pair!.from && clip.frames[(i + 1) % clip.frames.length] === pair!.to,
          );
          if (index < 0) throw new Error('Accepted transition is not bound to its authored clip');
          const hold = pair!.holdFraction ?? 0;
          const time =
            clip.durationsMs.slice(0, index).reduce((a, b) => a + b, 0) +
            clip.durationsMs[index]! * (hold + (1 - hold) * 0.5);
          p.labAnimator.start(clip);
          p.labAnimator.seek(time);
          p.labTime = time;
          for (const mode of ['original', 'guarded'] as const) {
            p.animationTreatment = mode;
            p.update(window.foundation.sim, 1, 0, { x: 0, z: 0 });
            if (mode === 'guarded' && !p.labSprite.lightingSample?.blend)
              throw new Error('Accepted transition did not reach the renderer');
          }
          observations.push({
            name: pair!.clip,
            heading: pair!.heading,
            from: pair!.from,
            to: pair!.to,
          });
        }
        const pairs = flow.pairs;
        try {
          flow.pairs = pairs.map((pair) => ({ ...pair, supported: false }));
          p.animationTreatment = 'guarded';
          p.update(window.foundation.sim, 1, 0, { x: 0, z: 0 });
          if (p.labSprite.lightingSample?.blend)
            throw new Error('Unsupported transition must use native held rendering');
        } finally {
          flow.pairs = pairs;
        }
        if (p.renderer.getContext().getError() !== 0) throw new Error('Animation shader failed');
        return {
          observations,
          pairs: p.animationFlow!.pairs.length,
          guarded: p.animationFlow!.pairs.filter((v) => v.supported).length,
        };
      });
      if (run.capture) {
        const capturedDrawings = await captureAnimationReview(page, output);
        await run.writeReport('animation-review.json', { ...report, capturedDrawings });
        console.log('Visual review: ' + output);
      }
      console.log(
        `PASS: ${report.observations.length} native transition paths, held/guarded playback; ${report.guarded}/${report.pairs} guarded candidates.`,
      );
    },
    { budget: flags.includes('--capture') ? 1024 ** 3 : 256 * 1024 ** 2 },
  );
}
