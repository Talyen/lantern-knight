import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';
import { clickCheckpointAction, loadCheckpoint } from '../fixtures/input';
import { sourceIdentity, sourceInputHash } from '../../tools/source-identity';
import os from 'node:os';

test('requested generic contact shadow comparison', async ({ page, context, request }) => {
  const directory = process.env.LANTERN_CONTACT_STUDY,
    baseline = process.env.LANTERN_CONTACT_BASELINE;
  test.skip(!directory, 'Explicit contact-shadow renderer review only');
  test.setTimeout(300_000);
  const beforePage = await context.newPage(),
    sources = await sourceIdentity(process.cwd()),
    identity = await (await request.get('/__lantern_identity')).json();
  const beforeIdentity = baseline
    ? await (await request.get(baseline + '/__lantern_identity')).json()
    : identity;
  expect(beforeIdentity.assets).toBe(identity.assets);
  const errors: string[] = [];
  beforePage.on('pageerror', (e) => errors.push(e.message));
  beforePage.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await mkdir(directory!, { recursive: true });
  for (const target of [beforePage, page]) {
    await target.goto(
      (target === beforePage ? (baseline ?? '') : '') + '/sandbox.html?scene=forge-fixture',
    );
    await target.waitForFunction(() => window.foundation?.ready);
    await target.evaluate(
      (baseline) => {
        const f = window.foundation,
          p = f.presentation;
        f.pause(true);
        Reflect.set(p, 'contactStudyUpdate', p.update.bind(p));
        Reflect.set(p, 'update', () => undefined);
        f.editPreview((sim) => {
          Object.assign(sim.hero, {
            x: 4.3,
            px: 4.3,
            z: 1.4,
            pz: 1.4,
            yaw: Math.PI / 4,
            state: 'idle',
            age: 0,
          });
          for (const actor of sim.enemies) {
            const spawn = sim.areaDefinition.spawns.find((s) => actor.id.endsWith(s.id))!;
            Object.assign(actor, {
              x: spawn.x,
              px: spawn.x,
              z: spawn.z,
              pz: spawn.z,
              state: 'idle',
              age: 0,
            });
          }
        });
        p.debug = false;
        p.beforeSceneRender = () => {
          p.aim.visible = false;
        };
        p.lookRenderer.setSettings({
          rig: 'lantern',
          tightContacts: true,
          paintedValues: true,
          paintedFinish: true,
          groundBounce: true,
        });
        if (baseline)
          for (const sprite of [
            ...[...p.actorPresentation.actors.values()].map((v) => v.sprite),
            ...p.roomPresentation.inkRoom!.sprites,
          ])
            sprite.frameIndex = new Map(
              [...sprite.frameIndex].map(([id, f]) => [id, { ...f, contact: undefined }]),
            );
        Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
        for (const visual of p.actorPresentation.actors.values()) visual.sprite.animator.seek(0);
        Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
      },
      target === beforePage && !baseline,
    );
  }
  const samples: {
    pair: number;
    after: boolean;
    frames: number[];
    gpu: unknown;
    buffer: unknown;
    settings: unknown;
    error: number;
  }[] = [];
  const measure = async (target: typeof page) => {
    await target.bringToFront();
    const sample = await target.evaluate(() => {
      const f = window.foundation,
        p = f.presentation,
        gl = p.renderer.getContext(),
        render = () => Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 1000 / 60, f.sim.hero);
      for (const v of p.actorPresentation.actors.values()) v.sprite.animator.seek(0);
      for (let i = 0; i < 30; i++) render();
      gl.finish();
      const frames = [];
      for (let i = 0; i < 40; i++) {
        const start = performance.now();
        render();
        gl.finish();
        frames.push(performance.now() - start);
      }
      return {
        frames,
        gpu: p.stats().gpu,
        buffer: p.stats().buffer,
        settings: p.lookRenderer.settings,
        error: gl.getError(),
      };
    });
    expect(sample.error).toBe(0);
    expect(sample.gpu).not.toMatch(/swiftshader|software|unavailable/i);
    return sample;
  };
  for (let pair = 0; pair < 5; pair++)
    for (const after of pair % 2 ? [true, false] : [false, true])
      samples.push({ pair, after, ...(await measure(after ? page : beforePage)) });
  // Keep one context, shader and allocations fixed to distinguish support
  // cost from context scheduling and frequency drift in the full comparison.
  const sameContext = [];
  for (let pair = 0; pair < 5; pair++)
    for (const after of pair % 2 ? [true, false] : [false, true]) {
      await page.evaluate((after) => {
        const p = window.foundation.presentation;
        for (const sprite of [
          ...[...p.actorPresentation.actors.values()].map((v) => v.sprite),
          ...p.roomPresentation.inkRoom!.sprites,
        ]) {
          let saved = Reflect.get(sprite, 'contactStudyFrames');
          if (!saved) {
            saved = sprite.frameIndex;
            Reflect.set(sprite, 'contactStudyFrames', saved);
          }
          sprite.frameIndex = after
            ? saved
            : new Map(
                [...saved].map(([id, f]: [string, any]) => [id, { ...f, contact: undefined }]),
              );
        }
      }, after);
      sameContext.push({ pair, after, ...(await measure(page)) });
    }
  await page.evaluate(() => {
    const p = window.foundation.presentation;
    for (const sprite of [
      ...[...p.actorPresentation.actors.values()].map((v) => v.sprite),
      ...p.roomPresentation.inkRoom!.sprites,
    ])
      sprite.frameIndex = Reflect.get(sprite, 'contactStudyFrames');
  });
  const profiles = [];
  for (const [target, label] of [
    [beforePage, 'before'],
    [page, 'after'],
  ] as const) {
    await target.bringToFront();
    const profile = await target.evaluate(async () => {
      const f = window.foundation,
        p = f.presentation,
        gl = p.renderer.getContext();
      p.lookRenderer.setProfiling(true);
      for (let i = 0; i < 30; i++) {
        Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
        gl.finish();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      for (const v of p.actorPresentation.actors.values()) v.sprite.animator.seek(0);
      Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
      const result = {
        assets: p.roomPresentation.inkRoom!.sprites.map((s) => ({
          id: s.manifest.asset.id,
          hash: s.manifest.hash,
          frame: s.animator.frame,
          contact: s.frameIndex.get(s.animator.frame)?.contact,
        })),
        cost: p.lookRenderer.stats().frameCost,
        memory: p.renderer.info.memory,
        stats: p.stats(),
        poses: [...p.actorPresentation.actors.values()].map((v) => ({
          frame: v.sprite.animator.frame,
          asset: v.sprite.manifest.asset.id,
          hash: v.sprite.manifest.hash,
          position: v.sprite.mesh.position.toArray(),
        })),
      };
      p.lookRenderer.setProfiling(false);
      return result;
    });
    profiles.push(profile);
    await target.getByRole('button', { name: 'More options', exact: true }).click();
    await target.getByRole('button', { name: 'Hide controls', exact: true }).click();
    await target.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const f = window.foundation;
      Reflect.get(f.presentation, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
    });
    await target.screenshot({ path: path.join(directory!, label + '.png') });
    for (let heading = 0; heading < 8; heading++) {
      await target.evaluate((heading) => {
        const f = window.foundation;
        f.editPreview((sim) => {
          sim.hero.yaw = (heading * Math.PI) / 4;
        });
        Reflect.get(f.presentation, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
      }, heading);
      await target.screenshot({ path: path.join(directory!, `${label}-heading-${heading}.png`) });
    }
    await target.evaluate(() => {
      const f = window.foundation;
      f.editPreview((sim) => {
        sim.hero.yaw = Math.PI / 4;
        sim.claimedObjects.add('forge-tool-chest');
      });
      Reflect.get(f.presentation, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
    });
    await target.screenshot({ path: path.join(directory!, label + '-toolbox-open.png') });
    for (const [state, age] of [
      ['walk', 8],
      ['attack', 16],
    ] as const) {
      await target.evaluate(
        ({ state, age }) => {
          const f = window.foundation;
          f.editPreview((sim) => {
            Object.assign(sim.hero, { state, age, px: sim.hero.x - 0.04 });
            if (state === 'walk') {
              const actor = sim.enemies.find((a) => a.definition.visual === 'ossuary-thrall')!;
              Object.assign(actor, { state: 'walk', px: actor.x - 0.03 });
            }
          });
          const p = f.presentation;
          Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 1000 / 60, f.sim.hero);
          for (const v of p.actorPresentation.actors.values()) v.sprite.animator.seek(150);
          Reflect.get(p, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
        },
        { state, age },
      );
      await target.screenshot({ path: path.join(directory!, `${label}-hero-${state}.png`) });
    }
    for (const age of [1, 24, 60]) {
      await target.evaluate((age) => {
        const f = window.foundation;
        f.editPreview((sim) => {
          const actor = sim.enemies
            .filter((a) => a.definition.visual === 'ossuary-thrall')
            .sort(
              (a, b) =>
                Math.hypot(a.x - sim.hero.x, a.z - sim.hero.z) -
                Math.hypot(b.x - sim.hero.x, b.z - sim.hero.z),
            )[0]!;
          actor.health = 0;
          actor.state = 'death';
          actor.age = age;
        });
        Reflect.get(f.presentation, 'contactStudyUpdate')(f.sim, 1, 0, f.sim.hero);
      }, age);
      await target.screenshot({ path: path.join(directory!, `${label}-death-${age}.png`) });
    }
  }
  expect(profiles[1]!.poses).toEqual(profiles[0]!.poses);
  expect(profiles[1]!.cost.calls).toBe(profiles[0]!.cost.calls);
  expect(profiles[1]!.cost.triangles - profiles[0]!.cost.triangles).toBeLessThanOrEqual(
    4 * (profiles[1]!.poses.length + profiles[1]!.assets.length),
  );
  expect(profiles[1]!.memory).toEqual(profiles[0]!.memory);
  expect(
    samples.every(
      (s) =>
        JSON.stringify(s.settings) === JSON.stringify(samples[0]!.settings) &&
        JSON.stringify(s.buffer) === JSON.stringify(samples[0]!.buffer),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(await sourceIdentity(process.cwd())).toEqual(sources);
  await writeFile(
    path.join(directory!, 'comparison.json'),
    JSON.stringify(
      {
        sources,
        runtimeWithoutPin: await sourceInputHash(process.cwd(), {
          scope: 'runtime',
          ignoreAssetPin: true,
        }),
        identity,
        beforeIdentity,
        baseline: baseline ?? 'same-renderer-supports-disabled',
        hardware: {
          model: os.cpus()[0]!.model,
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
        },
        samples,
        sameContext,
        profiles,
        limitations: [
          'Hardware browser rendering with animations advancing at 60 Hz and GPU completion; excludes display presentation and gameplay simulation. Profiling is separate from timed samples.',
          'Both pages use the candidate renderer and identical prepared assets; the control disables prepared supports. This isolates support shape and update cost, and does not compare old and new shader overhead.',
        ],
      },
      null,
      2,
    ),
  );
  await beforePage.close();
});

test('requested cohesion render cost comparison', async ({ page }) => {
  const directory = process.env.LANTERN_COHESION_MEASUREMENTS;
  test.skip(!directory, 'Explicit renderer measurement only');
  test.setTimeout(240_000);
  await page.goto('/sandbox.html?scene=orchard-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  const record = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation;
    f.pause(true);
    f.editPreview((sim) => {
      Object.assign(sim.hero, { x: -0.7, px: -0.7, z: 4.8, pz: 4.8, yaw: Math.PI / 2 });
    });
    const gl = p.renderer.getContext(),
      samples = [];
    const render = () => p.update(f.sim, 1, 0, { x: 0.3, z: 4.8 });
    p.lookRenderer.setProfiling(true);
    for (let pair = 0; pair < 5; pair++)
      for (const enabled of pair % 2 ? [true, false] : [false, true]) {
        p.lookRenderer.setSettings({
          paintedValues: enabled,
          paintedFinish: enabled,
          groundBounce: enabled,
          tightContacts: enabled,
        });
        const coldStart = performance.now();
        render();
        gl.finish();
        const firstRenderMs = performance.now() - coldStart;
        for (let i = 0; i < 15; i++) render();
        gl.finish();
        const frames = [];
        for (let i = 0; i < 30; i++) {
          const start = performance.now();
          render();
          gl.finish();
          frames.push(performance.now() - start);
        }
        samples.push({ enabled, firstRenderMs, frames, cost: p.lookRenderer.stats().frameCost });
      }
    p.lookRenderer.setProfiling(false);
    return {
      samples,
      stats: p.stats(),
      error: gl.getError(),
      userAgent: navigator.userAgent,
      limitations: [
        'Frozen-pose synchronous rendering includes CPU submission and GPU completion, not display presentation or gameplay simulation.',
      ],
    };
  });
  await mkdir(directory!, { recursive: true });
  await writeFile(path.join(directory!, 'render-cost.json'), JSON.stringify(record, null, 2));
  expect(record.error).toBe(0);
  for (const sample of record.samples) expect(sample.frames.length).toBe(30);
});

test('requested orchard cohesion comparisons', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit cohesion review captures only');
  test.setTimeout(240_000);
  await mkdir(directory!, { recursive: true });
  await page.goto('/sandbox.html?scene=orchard-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.evaluate(() => window.foundation.pause(true));
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  for (const [view, x, z] of [
    ['camp', 7.4, 9],
    ['cart', 10.5, 3],
    ['fight', -0.7, 4.8],
    ['shade', 6.9, 2.2],
  ] as const) {
    await page.evaluate(
      ({ x, z }) => {
        const f = window.foundation;
        f.editPreview((sim) => {
          Object.assign(sim.hero, { x, px: x, z, pz: z, yaw: Math.PI / 2 });
        });
        f.presentation.update(f.sim, 1, 0, { x: x + 1, z });
      },
      { x, z },
    );
    for (const rig of ['lantern', 'silver'] as const)
      for (const treatment of [
        'before',
        'values',
        'bounce',
        'contacts',
        'finish',
        'combined',
      ] as const) {
        await page.evaluate(
          ({ rig, treatment }) => {
            const f = window.foundation;
            f.presentation.lookRenderer.setSettings({
              rig,
              paintedValues: treatment === 'values' || treatment === 'combined',
              paintedFinish: treatment === 'finish' || treatment === 'combined',
              groundBounce: treatment === 'bounce' || treatment === 'combined',
              tightContacts: treatment === 'contacts' || treatment === 'combined',
            });
            f.presentation.update(f.sim, 1, 0, { x: f.sim.hero.x + 1, z: f.sim.hero.z });
          },
          { rig, treatment },
        );
        await page.screenshot({
          path: path.join(directory!, `cohesion-${view}-${rig}-${treatment}.png`),
        });
      }
  }
});

test('requested forge and chapel cohesion comparisons', async ({ page }) => {
  const directory = process.env.LANTERN_COHESION_INTERIORS;
  test.skip(!directory, 'Explicit production-art review only');
  test.setTimeout(240_000);
  await mkdir(directory!, { recursive: true });
  for (const [fixture, x, z] of [
    ['forge', 3.5, 3],
    ['chapel', -0.5, -1.5],
  ] as const) {
    await page.goto(`/sandbox.html?scene=${fixture}-fixture`);
    await page.waitForFunction(() => window.foundation?.ready);
    if (!(await page.getByRole('button', { name: 'More options', exact: true }).isVisible()))
      await page.keyboard.press('Escape');
    await page.evaluate(
      ({ x, z }) => {
        const f = window.foundation;
        f.pause(true);
        f.editPreview((sim) => {
          Object.assign(sim.hero, { x, px: x, z, pz: z, yaw: Math.PI / 2 });
        });
      },
      { x, z },
    );
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
    for (const rig of ['lantern', 'silver'] as const)
      for (const enabled of [false, true]) {
        await page.evaluate(
          ({ rig, enabled }) => {
            const f = window.foundation;
            f.presentation.lookRenderer.setSettings({
              rig,
              paintedValues: enabled,
              paintedFinish: enabled,
              groundBounce: enabled,
              tightContacts: enabled,
            });
            f.presentation.update(f.sim, 1, 0, { x: f.sim.hero.x + 1, z: f.sim.hero.z });
          },
          { rig, enabled },
        );
        await page.screenshot({
          path: path.join(directory!, `${fixture}-${rig}-${enabled ? 'after' : 'before'}.png`),
        });
      }
  }
});

test('requested supplied-artwork comparison captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit visual review captures only');
  test.setTimeout(300_000);
  await mkdir(directory!, { recursive: true });
  for (const treatment of ['gust', 'leaves', 'combined']) {
    await page.goto(`/index.html?automated&wind-preview=${treatment}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.locator('#menu-start').click();
    await page.locator('#pause').click();
    await clickCheckpointAction(page, 'save');
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = -0.707107;
      save.player.z = 0.707107;
      const state = save.areas[save.area];
      for (const actor of Object.values(state.actors) as { health: number }[]) actor.health = 0;
      state.cleared = true;
      localStorage.setItem(key, JSON.stringify(save));
    });
    await loadCheckpoint(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(directory!, `wind-${treatment}.png`) });
  }
  await page.mouse.move(950, 380);
  await page.mouse.click(950, 380, { button: 'right' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(directory!, 'lantern-flare.png') });
  await page.waitForTimeout(700);
  await page.mouse.click(950, 380);
  await page.waitForTimeout(700);
  await page.mouse.click(950, 380);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(directory!, 'lunge.png') });
  await page.waitForTimeout(700);
  await page.mouse.move(350, 450);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(170);
  await page.screenshot({ path: path.join(directory!, 'dodge.png') });
  for (const treatment of ['dust', 'leaves', 'combined']) {
    await page.goto(`/index.html?automated&dodge-preview=${treatment}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.locator('#menu-start').click();
    await page.locator('#pause').click();
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = -0.707107;
      save.player.z = 0.707107;
      localStorage.setItem(key, JSON.stringify(save));
    });
    await loadCheckpoint(page);
    await page.waitForTimeout(1000);
    await page.mouse.move(350, 450);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(180);
    await expect(page.locator('#status')).not.toContainText('cooling down');
    await page.screenshot({ path: path.join(directory!, `dodge-${treatment}.png`) });
  }
});

test('requested run contact drawing review in every heading', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit footfall drawing review only');
  test.setTimeout(180_000);
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.locator('#clip').selectOption('walk');
  if ((await page.locator('#pause').textContent()) === 'Pause')
    await page.locator('#pause').click();
  for (const heading of ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315']) {
    await page.locator('#heading').selectOption(heading);
    const times = await page.evaluate(
      (heading) =>
        window.foundation.presentation
          .getClip('walk', heading as any)
          .notifies.filter((n) => n.kind === 'footstep')
          .map((n) => n.atMs),
      heading,
    );
    expect(times).toHaveLength(2);
    for (const [index, time] of times.entries()) {
      await page.locator('#scrub').evaluate((node, time) => {
        const input = node as HTMLInputElement;
        input.value = String(time + 1);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, time);
      await page.screenshot({ path: path.join(directory!, `contact-${heading}-${index}.png`) });
    }
  }
});

test('requested lighting and Lunge facing captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit lighting and action registration review only');
  test.setTimeout(240_000);
  await mkdir(directory!, { recursive: true });
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#menu-start').click();
  await page.locator('#pause').click();
  await clickCheckpointAction(page, 'save');
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
    const save = JSON.parse(localStorage.getItem(key)!);
    save.player.x = -0.707107;
    save.player.z = 0.707107;
    const state = save.areas[save.area];
    for (const actor of Object.values(state.actors) as { health: number }[]) actor.health = 0;
    state.cleared = true;
    localStorage.setItem(key, JSON.stringify(save));
  });
  // Every rig loads the same checkpoint and camera pose.
  for (const rig of ['golden', 'silver', 'lantern']) {
    await page.goto(`/index.html?automated&lighting-preview=${rig}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.locator('#menu-start').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(directory!, `lighting-${rig}.png`) });
  }
  for (const [facing, x, y] of [
    ['right', 950, 150],
    ['up', 350, 150],
    ['left', 350, 650],
    ['down', 950, 650],
  ] as const) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(700);
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(directory!, `lunge-${facing}.png`) });
    await page.waitForTimeout(700);
  }
});

test('requested corrected Orchard placement captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit placement review captures only');
  test.setTimeout(240_000);
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#menu-start').click();
  await page.locator('#pause').click();
  await clickCheckpointAction(page, 'save');
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  for (const [name, x, z] of [
    ['east', 8.5, -4],
    ['south', 10, 3],
    ['west', -5, 5],
  ] as const) {
    if (name !== 'east') await page.locator('#pause').click();
    await page.evaluate(
      ({ x, z }) => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
        const save = JSON.parse(localStorage.getItem(key)!);
        save.player.x = x;
        save.player.z = z;
        localStorage.setItem(key, JSON.stringify(save));
      },
      { x, z },
    );
    await loadCheckpoint(page);
    await page.screenshot({ path: path.join(directory!, `orchard-${name}-clearance.png`) });
  }
});

test('requested generic contacts on additional upright props', async ({ page }) => {
  const directory = process.env.LANTERN_CONTACT_STUDY;
  test.skip(!directory, 'Explicit contact-shadow renderer review only');
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.evaluate(async () => {
    const editor = window.sceneEditor,
      view = editor.view(),
      doc = {
        ...structuredClone(editor.state().document),
        hero: { x: 0, z: 3 },
        objects: [
          {
            id: 'stone',
            kind: 'prop' as const,
            scale: 1,
            asset: 'ink-scenery',
            clip: 'gravestone',
            x: -3,
            z: 0,
            purpose: 'Generic contacts review',
          },
          {
            id: 'altar',
            kind: 'prop' as const,
            scale: 1,
            asset: 'ink-chapel-altar',
            clip: 'altar',
            x: 0,
            z: 0,
            purpose: 'Generic contacts review',
          },
          {
            id: 'lamp',
            kind: 'prop' as const,
            scale: 1,
            asset: 'ink-graveyard-scenery',
            clip: 'crook-lamp',
            x: 3,
            z: 0,
            purpose: 'Generic contacts review',
          },
        ],
      };
    await view.apply(doc);
    for (const object of doc.objects) {
      const s = view.presentation!.roomPresentation.inkRoom!.sprites.find(
          (s) => s.id === object.id,
        )!,
        frame = s.frameIndex.get(s.animator.frame)!,
        density = (frame.registration ?? s.manifest.asset).density;
      object.scale = Math.min((2 * density) / frame.trim[2], (2.7 * density) / frame.trim[3]);
    }
    await view.apply(doc);
    view.presentation!.lookRenderer.setSettings({
      lighting: false,
      shadows: false,
      tightContacts: true,
    });
    view.render();
  });
  const record = await page.evaluate(() =>
    window.sceneEditor.view().presentation!.roomPresentation.inkRoom!.sprites.map((s) => ({
      id: s.id,
      asset: s.manifest.asset.id,
      frame: s.animator.frame,
      contacts: s.frameIndex.get(s.animator.frame)?.contact,
    })),
  );
  expect(record.filter((s) => s.contacts?.length).length).toBeGreaterThanOrEqual(2);
  await page
    .locator('#viewport')
    .screenshot({ path: path.join(directory!, 'additional-after.png') });
  await page.evaluate(() => {
    const view = window.sceneEditor.view(),
      p = view.presentation!;
    for (const s of [
      ...p.roomPresentation.inkRoom!.sprites,
      ...[...p.actorPresentation.actors.values()].map((v) => v.sprite),
    ])
      s.frameIndex = new Map(
        [...s.frameIndex].map(([id, f]) => [id, { ...f, contact: undefined }]),
      );
    view.render();
  });
  await page
    .locator('#viewport')
    .screenshot({ path: path.join(directory!, 'additional-before.png') });
  await writeFile(path.join(directory!, 'additional-assets.json'), JSON.stringify(record, null, 2));
});
