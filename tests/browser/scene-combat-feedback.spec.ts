import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';

test('hero sword and Flare impacts, enemy swings and misses render and retire in the production chapel', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const directory = process.env.LANTERN_COMBAT_CAPTURES;
  if (directory) await mkdir(directory, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/sandbox.html?scene=chapel-fixture&automated');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.evaluate(() => {
    window.foundation.mode('encounter');
    window.foundation.pause(true);
  });
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  for (const action of ['sweep', 'lunge', 'flare', 'thrall', 'warden', 'miss'] as const) {
    await page.evaluate((action) => {
      const f = window.foundation;
      f.presentation.combatFeedback.reset();
      f.editPreview((sim) => {
        sim.movementPreview = false;
        sim.engaged = true;
        const enemy = sim.create(
          'feedback-opponent',
          'enemy',
          0.5,
          -1.5,
          action === 'warden' ? 'chapel-warden' : 'skeleton',
        );
        sim.actors = [sim.hero, enemy];
        Object.assign(sim.hero, {
          x: -0.5,
          px: -0.5,
          z: -1.5,
          pz: -1.5,
          health: 100,
          cooldown: 0,
          burn: undefined,
          pendingAction: undefined,
        });
        sim.start(sim.hero, 'idle', Math.PI / 2);
        enemy.stun = 10000;
        if (action === 'thrall' || action === 'warden' || action === 'miss') {
          if (action === 'miss') Object.assign(sim.hero, { x: -3, px: -3 });
          sim.start(enemy, 'attack', -Math.PI / 2);
        } else if (action === 'flare') sim.start(sim.hero, 'ability', Math.PI / 2);
        else {
          sim.hero.aim = Math.PI / 2;
          sim.startSword(sim.hero, action);
        }
      });
      f.presentation.update(f.sim, 1, 0, { x: 0.5, z: -1.5 });
    }, action);
    for (const stage of ['anticipation', 'contact', 'settled'] as const) {
      const result = await page.evaluate(
        async ({ action, stage }) => {
          const f = window.foundation;
          const gameplayPath = '/src/content/gameplay.ts';
          const { attackDefinition, tuning } = await import(gameplayPath);
          let direct = false;
          f.editPreview((sim) => {
            const source =
              action === 'thrall' || action === 'warden' || action === 'miss'
                ? sim.enemies[0]!
                : sim.hero;
            const windup =
              action === 'flare' ? tuning.ability.windup : attackDefinition(source).windup;
            const count =
              stage === 'anticipation'
                ? windup - 2 - source.age
                : stage === 'contact'
                  ? windup + 3 - source.age
                  : 24;
            for (let tick = 0; tick < Math.max(0, count); tick++) {
              const result = sim.step();
              direct ||= result.events.some(
                (event) => event.kind === 'damage' && event.phase === 'direct',
              );
              f.presentation.events.publish(result.events);
            }
          });
          const hero = f.sim.hero,
            enemy = f.sim.enemies[0]!;
          const body = [hero.x, hero.z, enemy.x, enemy.z, hero.health, enemy.health];
          f.presentation.update(f.sim, 1, 0, { x: enemy.x, z: enemy.z });
          const feedback = f.presentation.combatFeedback;
          return {
            direct,
            effects: feedback.group.children
              .filter((mesh) => mesh.visible)
              .map((mesh) => mesh.name),
            kick: feedback.cameraKick.length(),
            bodyUnchanged:
              JSON.stringify(body) ===
              JSON.stringify([hero.x, hero.z, enemy.x, enemy.z, hero.health, enemy.health]),
            error: f.presentation.renderer.getContext().getError(),
          };
        },
        { action, stage },
      );
      expect(result.error).toBe(0);
      expect(result.bodyUnchanged).toBe(true);
      if (stage === 'contact') {
        expect(result.direct, `${action} contact`).toBe(action !== 'miss');
        expect(result.effects.includes('combat-contact')).toBe(action !== 'miss');
        if (['thrall', 'warden', 'miss'].includes(action))
          expect(result.effects).toContain('combat-enemy-swing');
        if (action !== 'miss') expect(result.kick).toBeGreaterThan(0);
      }
      if (stage === 'settled') {
        expect(result.effects).not.toContain('combat-contact');
        expect(result.effects).not.toContain('combat-enemy-swing');
        expect(result.kick).toBe(0);
      }
      if (directory)
        await page.screenshot({ path: path.join(directory, `${action}-${stage}.png`) });
    }
  }
});
