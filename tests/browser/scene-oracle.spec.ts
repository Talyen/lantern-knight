import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';

test.use({ screenshot: 'only-on-failure' });

// These interaction proofs do not depend on a full-size framebuffer.
test.use({ viewport: { width: 800, height: 600 } });

test('forge Oracle renders its locked warning, contact and cancellation from simulation state', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const directory = process.env.LANTERN_ORACLE_CAPTURES;
  if (directory) await mkdir(directory, { recursive: true });
  const pending = new Set<string>();
  page.on('request', (request) => pending.add(new URL(request.url()).pathname));
  page.on('requestfinished', (request) => pending.delete(new URL(request.url()).pathname));
  page.on('requestfailed', (request) => pending.delete(new URL(request.url()).pathname));
  // Retain context and deletion ownership evidence when a software GPU restarts.
  await page.addInitScript(() => {
    const owners = new WeakMap<object, { gl: object; generation: number }>();
    const generations = new WeakMap<object, number>();
    document.addEventListener(
      'webglcontextlost',
      () => console.warn('Oracle WebGL context lost'),
      true,
    );
    document.addEventListener(
      'webglcontextrestored',
      (event) => {
        const gl = (event.target as HTMLCanvasElement).getContext('webgl2')!;
        generations.set(gl, (generations.get(gl) ?? 0) + 1);
        console.warn('Oracle WebGL context restored');
      },
      true,
    );
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<
      string,
      (this: WebGL2RenderingContext, ...args: unknown[]) => unknown
    >;
    for (const kind of [
      'Buffer',
      'Texture',
      'Framebuffer',
      'Renderbuffer',
      'Shader',
      'Program',
      'VertexArray',
      'Query',
      'TransformFeedback',
      'Sampler',
    ]) {
      const create = prototype['create' + kind]!,
        remove = prototype['delete' + kind]!;
      prototype['create' + kind] = function (...args) {
        const object = create.apply(this, args);
        if (object && typeof object === 'object')
          owners.set(object, { gl: this, generation: generations.get(this) ?? 0 });
        return object;
      };
      prototype['delete' + kind] = function (...args) {
        const object = args[0],
          owner = object && typeof object === 'object' ? owners.get(object) : undefined;
        if (owner && (owner.gl !== this || owner.generation !== (generations.get(this) ?? 0)))
          console.warn('Oracle stale GPU deletion', kind, new Error().stack);
        return remove.apply(this, args);
      };
    }
  });
  await page.goto('/sandbox.html?scene=forge-fixture&automated');
  try {
    await page.waitForFunction(() => window.foundation?.ready);
  } catch (error) {
    console.log('Oracle startup pending requests:', [...pending].slice(0, 12));
    console.log(
      'Oracle startup status:',
      await page.evaluate(() => ({
        visible: document.visibilityState,
        status: document.querySelector('#status')?.textContent,
        resources: performance
          .getEntriesByType('resource')
          .slice(-5)
          .map((entry) => entry.name),
      })),
    );
    throw error;
  }
  const target = await page.evaluate(() => {
    const f = window.foundation;
    f.mode('encounter');
    f.pause(true);
    f.editPreview((sim) => {
      sim.movementPreview = false;
      sim.engaged = true;
      sim.enemies
        .filter((a) => a.definition.id !== 'candlebone-oracle')
        .forEach((a) => {
          a.health = 0;
        });
      Object.assign(sim.hero, { x: 3, px: 3, z: 4, pz: 4, health: 100, stun: 0 });
      sim.start(sim.hero, 'idle');
      const oracle = sim.enemies.find((a) => a.definition.id === 'candlebone-oracle')!;
      oracle.cooldown = oracle.stun = 0;
      sim.start(oracle, 'idle');
      sim.step();
      if (sim.ribLanes.length !== 1) throw new Error('Expected a fresh courtyard cast');
    });
    f.presentation.update(f.sim, 1, 0, f.sim.hero);
    return { x: f.sim.hero.x, z: f.sim.hero.z };
  });
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  for (const stage of ['warning', 'contact', 'cancelled'] as const) {
    const observed = await page.evaluate(
      ({ stage, target }) => {
        const f = window.foundation;
        f.editPreview((sim) => {
          const oracle = sim.enemies.find((a) => a.definition.id === 'candlebone-oracle')!;
          const targetAge = stage === 'warning' ? 45 : stage === 'contact' ? 64 : 65;
          while (oracle.age < targetAge) {
            const result = sim.step();
            f.presentation.events.publish(result.events);
          }
          if (stage === 'cancelled') sim.damage(sim.hero, oracle, 1);
        });
        f.presentation.update(f.sim, 1, 0, target);
        const mesh = f.presentation.combatFeedback.group.children.find(
          (c) => c.name === 'combat-rib-lane',
        );
        return {
          health: f.sim.hero.health,
          lanes: f.sim.ribLanes.length,
          effect: mesh?.visible ?? false,
          registration: mesh?.userData,
          swordSwing: f.presentation.combatFeedback.group.children.some(
            (c) => c.name === 'combat-enemy-swing',
          ),
          error: f.presentation.renderer.getContext().getError(),
        };
      },
      { stage, target },
    );
    expect(observed.error).toBe(0);
    expect(observed.swordSwing).toBe(false);
    expect(observed.health).toBe(stage === 'warning' ? 100 : 86);
    expect(observed.lanes).toBe(stage === 'cancelled' ? 0 : 1);
    expect(observed.effect).toBe(stage !== 'cancelled');
    if (stage !== 'cancelled')
      expect(observed.registration).toMatchObject({ ...target, length: 4, width: 0.8 });
    if (directory)
      await page.screenshot({ path: path.join(directory, `forge-oracle-${stage}.png`) });
  }
  const escaped = await page.evaluate((target) => {
    const f = window.foundation;
    f.presentation.combatFeedback.reset();
    f.editPreview((sim) => {
      const oracle = sim.enemies.find((a) => a.definition.id === 'candlebone-oracle')!;
      Object.assign(sim.hero, {
        x: target.x,
        px: target.x,
        z: target.z,
        pz: target.z,
        health: 100,
      });
      sim.start(sim.hero, 'idle');
      oracle.cooldown = oracle.stun = 0;
      sim.start(oracle, 'idle');
      sim.step();
      if (sim.ribLanes.length !== 1) throw new Error('Expected a fresh courtyard cast');
      while (oracle.age < 64)
        f.presentation.events.publish(
          sim.step({
            move: { x: sim.hero.x < target.x + 1.1 ? 1 : 0, z: 0 },
            aim: { x: target.x + 3, z: target.z },
          }).events,
        );
    });
    f.presentation.update(f.sim, 1, 0, { x: target.x + 3, z: target.z });
    return {
      health: f.sim.hero.health,
      x: f.sim.hero.x,
      locked: f.sim.ribLanes[0],
      error: f.presentation.renderer.getContext().getError(),
    };
  }, target);
  expect(escaped.health).toBe(100);
  expect(escaped.x).toBeGreaterThan(target.x + 1);
  expect(escaped.locked).toMatchObject(target);
  expect(escaped.error).toBe(0);
  if (directory) await page.screenshot({ path: path.join(directory, 'forge-oracle-escaped.png') });
  await page.evaluate(() => {
    const f = window.foundation;
    f.editPreview((sim) => {
      const fire = sim.areaDefinition.campfires![0]!;
      Object.assign(sim.hero, { x: fire.x, z: fire.z });
      sim.step();
    });
    f.presentation.update(f.sim, 1, 0, f.sim.hero);
  });
  expect(await page.evaluate(() => window.foundation.sim.ribLanes.length)).toBe(0);
});
