import { sceneAssets } from '../src/content/world-art';
import { readAsset } from '../tools/assets/io';
import { defaultVisualEffects } from '../src/content/visual-effects';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportedPosition, isSupportedPosition, heightAt } from '../src/content/world';
import { content, contentDefinitions } from '../src/content/game-content';
import { Simulation } from '../src/core/simulation';
import { GameSession } from '../src/core/session';
import { parseGame, parseSettings, SaveContentError } from '../src/core/save';
import { worldVisuals, compositionPoint, compositionHeight } from '../src/content/world-art';
import { createBrowserBridge } from '../src/platform/browser-store';
import { launchEntry, checkpointDirectory } from '../electron/launch';
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: -1 } };
test('opening areas have a quiet approach, one/two skeletons and an unobstructed chase corridor', () => {
  assert.deepEqual(
    contentDefinitions.areas.map((a) => a.id),
    ['court', 'upper-landing'],
  );
  for (const [area, count] of [
    ['court', 1],
    ['upper-landing', 2],
  ] as const) {
    const s = new Simulation(content, 142, area, 1);
    assert.equal(s.enemies.length, count);
    assert.equal(s.engaged, false);
    const before = s.enemies.map((a) => [a.x, a.z, a.health]);
    for (let i = 0; i < 240; i++) s.step(still);
    assert.deepEqual(
      s.enemies.map((a) => [a.x, a.z, a.health]),
      before,
    );
    assert.equal(s.hero.health, 100);
    for (const spawn of s.areaDefinition.spawns) {
      assert.equal(spawn.actor, 'skeleton');
      assert.equal(spawn.jitterZ, undefined);
      for (let i = 0; i <= 20; i++) {
        const p = {
          x: spawn.x * (1 - i / 20),
          z: spawn.z + (((area === 'court' ? 5.8 : 7.5) - spawn.z) * i) / 20,
        };
        assert.ok(isSupportedPosition(s.areaDefinition, p, 0.3));
      }
    }
  }
  const s = new Simulation(content, 142, content.definitions.initialArea, 1);
  s.hero.z = 1.2;
  s.step(still);
  assert.ok(s.engaged);
  assert.notEqual(s.enemies[0]!.state, 'idle');
  const group = new Simulation(content, 142, 'upper-landing', 1);
  group.damage(group.hero, group.enemies[0]!, 1);
  assert.ok(group.engaged);
  group.step(still);
  assert.equal(group.enemies[1]!.state, 'walk');
});
test('activation survives load/revisit and resets on death; backward passage allows retreat', () => {
  const session = new GameSession(content);
  assert.throws(() => session.prepareTransition('landing'), /unavailable/);
  session.sim.damage(session.sim.hero, session.sim.enemies[0]!, 100);
  session.step(still);
  session.commitTransition(session.prepareTransition('landing'));
  assert.equal(session.sim.engaged, false);
  session.sim.damage(session.sim.hero, session.sim.enemies[0]!, 1);
  session.commitTransition(session.prepareTransition('court'));
  assert.ok(session.sim.cleared);
  session.commitTransition(session.prepareTransition('landing'));
  assert.ok(session.sim.engaged);
  assert.equal(session.sim.enemies[0]!.health, 49);
  const save = session.captureSave(),
    restored = new GameSession(content);
  restored.restoreSave(save);
  assert.ok(restored.sim.engaged);
  restored.sim.damage(restored.sim.enemies[0]!, restored.sim.hero, 1000);
  restored.sim.hero.age = 90;
  restored.step(still);
  assert.equal(restored.sim.engaged, false);
  assert.deepEqual(
    restored.sim.enemies.map((a) => a.health),
    [50, 50],
  );
  restored.sim.hero.z = 8.3;
  assert.equal(restored.step(still).transition, 'court');
});
test('authored box footprints block bodies at edges and corners without escaping bounds', () => {
  const area = content.area('court'),
    p = area.props.find((p) => p.id === 'family-tomb-west')!;
  for (const point of [
    { x: p.x, z: p.z },
    { x: p.x + 0.9, z: p.z + 0.3 },
    { x: -100, z: 100 },
  ]) {
    const q = supportedPosition(area, point, 0.3);
    assert.ok(isSupportedPosition(area, q, 0.3));
    assert.ok(q.x >= area.bounds.minX + 0.3 && q.z <= area.bounds.maxZ - 0.3);
  }
  for (const a of content.areas.values())
    for (const entry of a.entries) assert.ok(isSupportedPosition(a, entry, 0.3));
});
test('standalone chapel, burial plots and porch preserve contact and reciprocal passages', () => {
  const outside = worldVisuals.court!,
    inside = worldVisuals['upper-landing']!;
  assert.ok(outside.paths[0]!.points.length > 4);
  assert.equal(outside.graves.filter((g) => g.age === 'kept').length, 1);
  assert.ok(
    outside.graves.filter((g) => g.age === 'old').length >
      outside.graves.filter((g) => g.age === 'kept').length,
  );
  assert.ok(outside.props.every((p) => p.purpose));
  assert.ok(inside.props.every((p) => p.purpose));
  for (const area of content.areas.values())
    for (const collider of area.props) {
      const art = worldVisuals[area.id]!,
        sprite = art.props.find((p) => p.id === collider.id),
        wall = art.walls.find((w) => w.id === collider.id);
      if (collider.shape === 'polygon') {
        assert.ok(collider.polygon!.length >= 3);
        continue;
      }
      assert.ok(sprite || wall);
      if (sprite) assert.deepEqual(collider.size, sprite.footprint);
      else {
        assert.equal(collider.x, (wall!.from.x + wall!.to.x) / 2);
        assert.equal(collider.z, (wall!.from.z + wall!.to.z) / 2);
      }
    }
  const graveyard = content.area('court'),
    chapel = content.area('upper-landing');
  assert.equal(heightAt(graveyard, 4, 0), 0);
  assert.equal(heightAt(graveyard, 0, -5.4), 0.15);
  assert.equal(heightAt(graveyard, 0, -5.95), 0.3);
  assert.equal(heightAt(chapel, 0, 0), 0.3);
  assert.equal(graveyard.exits[0]!.destination, chapel.id);
  assert.equal(chapel.exits[0]!.destination, graveyard.id);
  assert.equal(chapel.exits[0]!.requiresClear, false);
  assert.equal(outside.walls.filter((w) => w.id.includes('chapel')).length, 2);
  assert.ok(sceneAssets(outside).includes('ink-chapel-front'));
  assert.ok(!outside.props.some((p) => p.clip === 'chapel'));
  assert.equal(graveyard.props.filter((p) => p.shape === 'polygon').length, 1);
  assert.equal(graveyard.props.find((p) => p.shape === 'polygon')!.height, 0.3);
  assert.ok(
    chapel.bounds.minX > inside.interior!.minX && chapel.bounds.maxX < inside.interior!.maxX,
    'playable bounds remain inside the physical chapel walls',
  );
  assert.ok(chapel.bounds.maxZ - chapel.bounds.minZ >= 17);
  assert.ok(inside.props.every((p) => !['yew', 'tree', 'gravestone'].includes(p.clip)));
});
test('the redesigned processional route stays traversable and the burial clearing supports a full dodge', () => {
  const area = content.area('court'),
    route = worldVisuals.court!.paths[0]!;
  // The first control point continues the approach outside the playable bounds.
  for (let i = 2; i < route.points.length; i++) {
    const a = route.points[i - 1]!,
      b = route.points[i]!;
    for (let j = 0; j <= 40; j++) {
      const t = j / 40,
        p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      assert.ok(
        isSupportedPosition(area, p, 0.3),
        `processional route obstructed at ${p.x}/${p.z}`,
      );
    }
  }
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const sim = new Simulation(content, 142, content.definitions.initialArea, 1);
    sim.enemies.forEach((a) => (a.health = 0));
    Object.assign(sim.hero, { x: 0, z: 0.25, yaw, aim: yaw });
    sim.step({
      move: { x: Math.sin(yaw), z: Math.cos(yaw) },
      aim: { x: Math.sin(yaw) * 3, z: 0.25 + Math.cos(yaw) * 3 },
      dodge: true,
    });
    while (sim.hero.state === 'dodge') sim.step(still);
    assert.ok(
      Math.abs(Math.hypot(sim.hero.x, sim.hero.z - 0.25) - 2.1) < 0.03,
      'burial props must not truncate the full dodge',
    );
  }
});
test('authored camera framing remains inside the composition bounds at every room edge', () => {
  for (const area of content.areas.values())
    for (const x of [area.bounds.minX, 0, area.bounds.maxX])
      for (const z of [area.bounds.minZ, 0, area.bounds.maxZ]) {
        const q = compositionPoint(area.id, { x, z }),
          b = worldVisuals[area.id]!.camera.bounds;
        assert.ok(q.x >= b.minX && q.x <= b.maxX && q.z >= b.minZ && q.z <= b.maxZ);
      }
});
test('narrow Graveyard framing keeps the hero and full silhouette inside the viewport', () => {
  const elevation = Math.atan(1 / Math.sqrt(2)),
    halfHeight = 4.5;
  for (const halfWidth of [(halfHeight * 9) / 16, (halfHeight * 16) / 9, (halfHeight * 21) / 9])
    for (const hero of [
      { x: -3.3, z: 6.65 },
      { x: 0, z: 1 },
      { x: 5.9, z: 3.7 },
      { x: 0, z: -5.5 },
    ]) {
      const target = compositionPoint('court', hero, { halfWidth, halfHeight }),
        dx = hero.x - target.x,
        dz = hero.z - target.z,
        x = (dx - dz) / Math.sqrt(2),
        root =
          (-(dx + dz) * Math.sin(elevation)) / Math.sqrt(2) -
          compositionHeight('court', hero) * Math.cos(elevation);
      assert.ok(Math.abs(x) < halfWidth - 0.7);
      assert.ok(root > -halfHeight + 0.5);
      assert.ok(root + 1.8 * Math.cos(elevation) < halfHeight - 0.5);
    }
});
function prototype() {
  return {
    version: 3,
    seed: 142,
    wins: 1,
    area: 'upper-landing',
    player: { x: 0, z: 6.2, health: 63, cooldown: 70, dodgeCooldown: 12 },
    areas: {
      court: {
        cleared: true,
        actors: Object.fromEntries(
          [1, 2, 3].map((i) => [`warden-${i}`, { x: 0, z: 0, health: 0 }]),
        ),
      },
      'upper-landing': {
        cleared: false,
        actors: Object.fromEntries(
          [1, 2, 3].map((i) => [`warden-${i}`, { x: 0, z: 0, health: i === 1 ? 25 : 70 }]),
        ),
      },
    },
  };
}
test('prototype migration preserves clears/health/cooldowns, restarts unfinished encounters and protects unknown content', () => {
  const previous = prototype(),
    bytes = JSON.stringify(previous),
    save = parseGame(previous, content);
  assert.equal(JSON.stringify(previous), bytes);
  assert.equal(save.version, 6);
  assert.equal(save.player.health, previous.player.health);
  assert.equal(save.player.cooldown, previous.player.cooldown);
  assert.equal(save.player.dodgeCooldown, previous.player.dodgeCooldown);
  assert.equal(save.player.z, 7.5);
  assert.ok(save.areas.court!.cleared);
  assert.equal(Object.keys(save.areas.court!.actors).length, 1);
  assert.deepEqual(
    Object.values(save.areas['upper-landing']!.actors).map((a) => a.health),
    [50, 50],
  );
  assert.equal(save.areas['upper-landing']!.engaged, false);
  previous.player.x = -5.3;
  previous.player.z = -3.4;
  const relocated = parseGame(previous, content);
  assert.equal(relocated.player.x, 0);
  assert.equal(relocated.player.z, 7.5);
  assert.equal(relocated.player.health, 63);
  const unknown = prototype();
  unknown.areas.court.actors['unknown'] = { x: 0, z: 0, health: 0 };
  assert.throws(() => parseGame(unknown, content), SaveContentError);
  assert.deepEqual(
    parseSettings({ version: 2, verticalSpan: 13, renderScale: 1, showDebug: false }),
    {
      version: 5,
      verticalSpan: 13,
      renderScale: 1,
      showDebug: false,
      depthOfField: 1,
      visualEffects: defaultVisualEffects(),
    },
  );
});
test('Game, developer preview and Sandbox have isolated checkpoints; Sandbox refuses writes', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    },
  });
  try {
    const game = createBrowserBridge(),
      preview = createBrowserBridge('preview'),
      sandbox = createBrowserBridge('sandbox'),
      save = new GameSession(content).captureSave();
    await game.saveGame(save);
    await preview.saveGame({ ...save, wins: 4 });
    await assert.rejects(sandbox.saveGame(save), /denied/);
    assert.equal((await sandbox.loadGame()).status, 'empty');
    assert.equal(((await preview.loadGame()) as { data: { wins: number } }).data.wins, 4);
    assert.equal(((await game.loadGame()) as { data: { wins: number } }).data.wins, 0);
    assert.notEqual(
      checkpointDirectory('/profile', true, 'game'),
      checkpointDirectory('/profile', true, 'sandbox'),
    );
    assert.equal(checkpointDirectory('/profile', false, 'game'), '/profile/saves');
    assert.equal(launchEntry(false, 'sandbox'), 'index.html');
    assert.equal(launchEntry(true, 'sandbox'), 'sandbox.html');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
test('skeleton preparation retains native source pixels and registers the body independently of the weapon', async () => {
  const m = JSON.parse(await readAsset('public/generated/ink/ink-skeleton/manifest.json', 'utf8'));
  assert.deepEqual(m.asset.anchor, [480, 1260]);
  assert.ok(m.asset.density > 600);
  assert.equal(content.actor('skeleton').maxHealth, 50);
});

test('v4 location migration preserves clear progress and vital state without reusing discarded positions', () => {
  const previous = {
    version: 4,
    seed: 142,
    wins: 1,
    area: 'upper-landing',
    player: { x: 6, z: 6, health: 54, cooldown: 40, dodgeCooldown: 11 },
    areas: {
      court: { engaged: true, cleared: true, actors: { 'warden-1': { x: 0, z: 0, health: 0 } } },
      'upper-landing': {
        engaged: true,
        cleared: false,
        actors: { 'warden-1': { x: 1, z: -1, health: 25 }, 'warden-2': { x: 2, z: 0, health: 50 } },
      },
    },
  };
  const before = JSON.stringify(previous),
    save = parseGame(previous, content);
  assert.equal(JSON.stringify(previous), before);
  assert.equal(save.version, 6);
  assert.equal(save.player.health, 54);
  assert.equal(save.player.cooldown, 40);
  assert.equal(save.player.dodgeCooldown, 11);
  assert.deepEqual([save.player.x, save.player.z], [0, 7.5]);
  assert.ok(save.areas.court!.cleared);
  assert.equal(save.areas['upper-landing']!.engaged, false);
  assert.deepEqual(
    Object.values(save.areas['upper-landing']!.actors).map((a) => a.health),
    [50, 50],
  );
});

test('skeletons close the last part of their reach and can hit a stationary player', () => {
  const s = new Simulation(content, 142, content.definitions.initialArea, 1),
    enemy = s.enemies[0]!;
  Object.assign(s.hero, { x: enemy.x, z: enemy.z + enemy.definition.melee.range + 0.06 });
  s.move(s.hero, 0, 0);
  for (let i = 0; i < 120; i++) s.step(still);
  assert.ok(s.hero.health < 100, 'an enemy must not swing forever outside its hit range');
  assert.ok(s.enemies[0]!.health === 50);
});
