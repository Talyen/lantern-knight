import { smokeLaunch } from './smoke-launch';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../src/inspection';
const run = await smokeLaunch(true, [], { budget: 32 * 1024 ** 2 }),
  { page, errors, output } = run;
try {
  await page.waitForFunction(() => window.foundation?.ready, {}, { timeout: 60000 });
  await page.evaluate(async () => {
    const f = window.foundation;
    await f.fixture('upper-landing');
    f.pause(true);
    document.querySelector<HTMLElement>('#modal')!.hidden = true;
    f.presentation.setDepthOfField(0);
    f.sim.enemies.forEach((a) => (a.health = 0));
    Object.assign(f.sim.hero, { x: 0, z: 1, px: 0, pz: 1 });
  });
  for (const area of ['court', 'upper-landing']) {
    await page.evaluate(async (area) => {
      const f = window.foundation;
      await f.fixture(area);
      f.mode('encounter');
      f.pause(true);
      document.querySelector<HTMLElement>('#modal')!.hidden = true;
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 0 });
    }, area);
    assert.deepEqual(
      await page.evaluate(() => {
        const s = window.foundation.presentation.lookRenderer.settings;
        return [s.rig, s.look, s.strength];
      }),
      ['golden', 'diorama', 1.5],
    );
  }
  const observations = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation,
      s = f.sim,
      h = s.hero,
      results = [];
    for (const [heading, yaw] of [
      ['d00', 0],
      ['d45', Math.PI / 4],
      ['d90', Math.PI / 2],
      ['d135', (Math.PI * 3) / 4],
      ['d180', Math.PI],
      ['d225', (Math.PI * 5) / 4],
      ['d270', -Math.PI / 2],
      ['d315', -Math.PI / 4],
    ] as const) {
      for (const [state, kind] of [
        ['idle', 'sweep'],
        ['walk', 'sweep'],
        ['attack', 'sweep'],
        ['attack', 'lunge'],
        ['dodge', 'sweep'],
        ['ability', 'sweep'],
        ['hurt', 'sweep'],
        ['death', 'sweep'],
      ] as const) {
        if (!['d00', 'd90', 'd180', 'd270'].includes(heading) && state !== 'walk') continue;
        h.aim = yaw;
        h.health = state === 'death' ? 0 : 100;
        if (state === 'attack') s.startSword(h, kind);
        else s.start(h, state, yaw);
        const clip = p.getClip(
          state === 'attack'
            ? kind
            : {
                idle: 'idle',
                walk: 'walk',
                dodge: 'dodge',
                ability: 'cast_lantern_flare',
                hurt: 'hit',
                death: 'death',
              }[state],
          heading,
          p.packs.get('ink-hero-current')!.manifest,
        );
        const expected = new Set(clip.frames),
          seen = new Set<string>();
        p.update(s, 1, 0, { x: 0, z: 0 });
        let elapsed = 0;
        for (const hold of clip.durationsMs) {
          const time = elapsed + hold / 2;
          elapsed += hold;
          h.age = Math.floor((time * 60) / 1000);
          if (state === 'idle' || state === 'walk') p.actors.get(h.id)!.sprite.animator.seek(time);
          p.update(s, 1, 0, { x: 0, z: 0 });
          const sprite = p.actors.get(h.id)!.sprite;
          seen.add(sprite.lastFrame);
          if (
            sprite.manifest.asset.id !== 'ink-hero-current' ||
            !expected.has(sprite.lastFrame) ||
            Math.hypot(
              sprite.mesh.position.x - h.x,
              sprite.mesh.position.y - h.y,
              sprite.mesh.position.z - h.z,
            ) > 1e-6
          )
            throw new Error('Hero frame or foot binding differs');
        }
        if ([...expected].some((id) => !seen.has(id)))
          throw new Error('Authored timeline drawing was skipped: ' + state + '/' + heading);
        results.push({ heading, state, kind, drawings: seen.size });
      }
    }
    h.health = 100;
    h.aim = Math.PI / 2;
    s.startSword(h, 'sweep');
    h.age = 30;
    p.update(s, 1, 0, { x: 0, z: 0 });
    return { cases: results, stats: p.stats() };
  });
  assert.equal(observations.cases.length, 36);
  assert.ok(observations.stats.atlasBytes <= 768 * 1024 ** 2);
  if (run.capture)
    await page.locator('canvas').screenshot({ path: path.join(output, 'hero-sweep-gameplay.png') });
  await page.getByRole('button', { name: 'Animation lab', exact: true }).click();
  await page.locator('#asset').selectOption('ink-hero-current');
  await page.waitForFunction(
    () =>
      window.foundation.presentation.labAsset === 'ink-hero-current' &&
      !!window.foundation.presentation.animationFlow,
  );
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.labSprite.manifest.asset.id),
    'ink-hero-current',
  );
  await page.locator('#animation-comparison').selectOption('timing');
  await page.locator('#clip').selectOption('sweep');
  const timing = await page.evaluate(() => {
    const p = window.foundation.presentation;
    p.update(window.foundation.sim, 1, 0, { x: 0, z: 0 });
    return [
      p.labAnimator.clip.durationsMs.reduce((a, b) => a + b, 0),
      p.secondSprite.animator.clip.durationsMs.reduce((a, b) => a + b, 0),
    ];
  });
  assert.ok(Math.abs(timing[0]! - 900) < 0.001);
  assert.notEqual(timing[0], timing[1]);
  await page.locator('#play').click();
  const comparison = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation;
    p.labAnimator.seek(350);
    p.labTime = 350;
    p.update(f.sim, 1, 0, { x: 0, z: 0 });
    return [p.labSprite.lastFrame, p.secondSprite.lastFrame];
  });
  assert.notEqual(
    comparison[0],
    comparison[1],
    'timing comparison must display different poses on shared elapsed time',
  );
  if (run.capture) {
    await page.waitForFunction(() =>
      document.querySelector('#visual-time')?.textContent?.startsWith('350'),
    );
    await page.screenshot({ path: path.join(output, 'sweep-timing-review.png') });
    console.log('Hero visual review: ' + output);
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'hero-report.json'), JSON.stringify(observations, null, 2));
  console.log(
    `PASS: 36 hero action/heading journeys, exact authored frame coverage, foot registration, ${Math.round(observations.stats.atlasBytes / 1024 ** 2)} MiB resident atlases, and current animation comparison.`,
  );
} catch (error) {
  await fs.writeFile(
    path.join(output, 'hero-failure.json'),
    JSON.stringify({ error: String(error), errors }),
  );
  throw error;
} finally {
  await run.close();
}
