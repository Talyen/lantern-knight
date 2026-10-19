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
  for (const action of [
    'sweep',
    'lunge',
    'flare',
    'thrall',
    'attendant',
    'warden',
    'miss',
    'dodge',
  ] as const) {
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
          action === 'warden'
            ? 'chapel-warden'
            : action === 'attendant'
              ? 'chapel-attendant'
              : 'skeleton',
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
        if (
          action === 'thrall' ||
          action === 'attendant' ||
          action === 'warden' ||
          action === 'miss'
        ) {
          if (action === 'miss') Object.assign(sim.hero, { x: -3, px: -3 });
          sim.start(enemy, 'attack', -Math.PI / 2);
        } else if (action === 'flare') sim.start(sim.hero, 'ability', Math.PI / 2);
        else if (action === 'dodge') sim.start(sim.hero, 'dodge', Math.PI / 2);
        else {
          sim.hero.aim = Math.PI / 2;
          sim.startSword(sim.hero, action);
        }
      });
      f.presentation.update(f.sim, 1, 0, { x: 0.5, z: -1.5 });
    }, action);
    const stages = [
      'anticipation',
      'contact',
      'aftermath',
      ...(action === 'flare' ? (['stagger'] as const) : []),
      'settled',
    ] as const;
    for (const stage of stages) {
      const result = await page.evaluate(
        async ({ action, stage }) => {
          const f = window.foundation;
          const gameplayPath = '/src/content/gameplay.ts';
          const { attackDefinition, tuning } = await import(gameplayPath);
          let direct = false;
          f.editPreview((sim) => {
            const source =
              action === 'thrall' ||
              action === 'attendant' ||
              action === 'warden' ||
              action === 'miss'
                ? sim.enemies[0]!
                : sim.hero;
            const windup =
              action === 'flare'
                ? tuning.ability.windup
                : action === 'dodge'
                  ? tuning.dodge.travelStart
                  : attackDefinition(source).windup;
            const count =
              stage === 'anticipation'
                ? windup - 2 - source.age
                : stage === 'contact'
                  ? windup + 3 - source.age
                  : stage === 'aftermath' || stage === 'stagger'
                    ? 10
                    : 60;
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
            assets: feedback.group.children
              .filter((mesh) => mesh.visible)
              .map((mesh) => mesh.userData.asset as string),
            rangeRingVisible: f.presentation.flare.visible,
            bodyUnchanged:
              JSON.stringify(body) ===
              JSON.stringify([hero.x, hero.z, enemy.x, enemy.z, hero.health, enemy.health]),
            error: f.presentation.renderer.getContext().getError(),
            enemyState: enemy.state,
            staggerRemaining: enemy.stun,
          };
        },
        { action, stage },
      );
      expect(result.error).toBe(0);
      expect(result.bodyUnchanged).toBe(true);
      expect(result.rangeRingVisible).toBe(false);
      if (stage === 'stagger') {
        expect(result.staggerRemaining).toBeGreaterThan(0);
        expect(result.enemyState).toBe('hurt');
      }
      if (stage === 'contact') {
        expect(result.direct, `${action} contact`).toBe(action !== 'miss' && action !== 'dodge');
        expect(result.effects.includes('combat-contact')).toBe(
          action !== 'miss' && action !== 'dodge',
        );
        if (['thrall', 'attendant', 'warden', 'miss'].includes(action))
          expect(result.effects).toContain('combat-enemy-swing');
        if (action !== 'miss' && action !== 'dodge') expect(result.kick).toBeGreaterThan(0);
        if (action === 'flare')
          expect(result.assets).toContain('library-animation-31cc2e4e941e9c27-14c5aeddfa12');
        if (action === 'thrall' || action === 'attendant')
          expect(result.assets).toContain('library-combat-ivory-rake');
        if (action === 'warden') expect(result.assets).toContain('library-combat-rust-crescent');
        if (action === 'dodge') expect(result.assets).toContain('library-dash_wake');
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
  // Keep poise and the shared stagger readable with the complete enemy group.
  for (const stage of ['poise', 'stagger'] as const) {
    const result = await page.evaluate(async (stage) => {
      const f = window.foundation,
        gameplayPath = '/src/content/gameplay.ts',
        { tuning } = await import(gameplayPath);
      f.editPreview((sim) => {
        if (stage === 'poise') {
          f.presentation.combatFeedback.reset();
          const warden = sim.create('group-warden', 'enemy', 0.8, -1.5, 'chapel-warden'),
            west = sim.create('group-west', 'enemy', -1.5, -1.3, 'chapel-attendant'),
            north = sim.create('group-north', 'enemy', -0.5, -3, 'chapel-attendant');
          sim.actors = [sim.hero, warden, west, north];
          Object.assign(sim.hero, { x: -0.5, px: -0.5, z: -1.5, pz: -1.5, health: 100 });
          sim.start(sim.hero, 'idle');
          for (const enemy of sim.enemies) {
            sim.start(enemy, 'attack', Math.atan2(sim.hero.x - enemy.x, sim.hero.z - enemy.z));
            enemy.age = enemy.definition.attack.windup - 6;
          }
          sim.step();
          sim.damage(sim.hero, warden, 1);
          f.presentation.events.publish(sim.events);
        } else {
          sim.start(sim.hero, 'ability');
          sim.hero.age = tuning.ability.windup;
          for (let tick = 0; tick < 21; tick++) f.presentation.events.publish(sim.step().events);
        }
      });
      f.presentation.update(f.sim, 1, 0, { x: 0.8, z: -1.5 });
      return {
        enemies: f.sim.enemies.map((enemy) => ({ state: enemy.state, stun: enemy.stun })),
        heroHealth: f.sim.hero.health,
        enemyEffects: f.presentation.combatFeedback.group.children.filter(
          (mesh) => mesh.visible && mesh.name === 'combat-enemy-swing',
        ).length,
        error: f.presentation.renderer.getContext().getError(),
      };
    }, stage);
    expect(result.error).toBe(0);
    expect(result.heroHealth).toBe(100);
    if (stage === 'stagger') expect(result.enemyEffects).toBe(0);
    for (const enemy of result.enemies) {
      expect(enemy.state).toBe(stage === 'poise' ? 'attack' : 'hurt');
      if (stage === 'stagger') expect(enemy.stun).toBeGreaterThan(0);
    }
    if (directory)
      await page.screenshot({ path: path.join(directory, `chapel-group-${stage}.png`) });
  }
});

for (const [scene, spawnId, actors] of [
  [
    'orchard-fixture',
    'first',
    ['fallen-orchard-worker', 'orchard-feral-boar', 'rootbound-scarecrow'],
  ],
  ['clearing-fixture', 'clearing-a', ['mossfang-scavenger', 'rootbound-scarecrow']],
] as const) {
  test(`${scene} creatures use their drawn attacks and neutral hit contacts`, async ({ page }) => {
    await page.goto(`/sandbox.html?scene=${scene}&automated`);
    await page.waitForFunction(() => window.foundation?.ready);
    await page.evaluate(() => window.foundation.pause(true));
    for (const actor of actors) {
      const proof = await page.evaluate(
        ({ actor, spawnId }) => {
          const f = window.foundation;
          const visibleAssets = () =>
            f.presentation.combatFeedback.group.children
              .filter((mesh) => mesh.visible)
              .map((mesh) => mesh.userData.asset as string);
          const setup = (attacker: 'hero' | 'enemy') => {
            f.presentation.combatFeedback.reset();
            f.editPreview((sim) => {
              const spawn = sim.areaDefinition.spawns.find((s) => s.id === spawnId)!;
              const enemy = sim.create('creature-feedback-proof', 'enemy', spawn.x, spawn.z, actor);
              sim.actors = [sim.hero, enemy];
              sim.movementPreview = false;
              sim.engaged = true;
              Object.assign(sim.hero, {
                x: spawn.x - 0.9,
                px: spawn.x - 0.9,
                z: spawn.z,
                pz: spawn.z,
                health: 100,
                cooldown: 0,
                burn: undefined,
                pendingAction: undefined,
              });
              sim.start(sim.hero, 'idle', Math.PI / 2);
              enemy.stun = 10000;
              if (attacker === 'enemy') sim.start(enemy, 'attack', -Math.PI / 2);
              else {
                sim.hero.aim = Math.PI / 2;
                sim.startSword(sim.hero, 'sweep');
              }
            });
          };
          setup('enemy');
          f.editPreview((sim) => {
            sim.enemies[0]!.age = sim.enemies[0]!.definition.attack.windup + 1;
          });
          f.presentation.update(f.sim, 1, 0, f.sim.enemies[0]!);
          const attack = visibleAssets();
          setup('hero');
          let damaged = false;
          f.editPreview((sim) => {
            for (let i = 0; i < sim.hero.definition.attack.windup + 3; i++) {
              const result = sim.step();
              damaged ||= result.events.some(
                (e) => e.kind === 'damage' && e.target !== sim.hero.id,
              );
              f.presentation.events.publish(result.events);
            }
          });
          f.presentation.update(f.sim, 1, 0, f.sim.enemies[0]!);
          return {
            attack,
            contact: visibleAssets(),
            damaged,
            error: f.presentation.renderer.getContext().getError(),
          };
        },
        { actor, spawnId },
      );
      expect(proof.attack).not.toContain('library-combat-ivory-rake');
      expect(proof.contact).not.toContain('library-combat-ivory-rupture');
      expect(proof.contact).not.toContain('library-amber_impact');
      expect(proof.contact).toContain('library-neutral_contact_snap');
      expect(proof.damaged).toBe(true);
      expect(proof.error).toBe(0);
    }
  });
}
