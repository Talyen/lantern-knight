import test from 'node:test';
import assert from 'node:assert/strict';
import { forgeFixture, supplyForge } from '../fixtures/forge';
import { GameSession } from '../../src/core/session';
import { InventoryState } from '../../src/core/inventory';
import { kitAttributes, scaledDamage } from '../../src/content/progression';
import { tuning, attackDefinition } from '../../src/content/gameplay';
import { parseGame } from '../../src/core/save';
import { StorageCodec } from '../../src/platform/storage-codec';
import { ContentRegistry, type ContentDefinitions } from '../../src/content/world';
import { interactionTarget } from '../../src/core/interaction';
const idle = { move: { x: 0, z: 0 }, aim: { x: 4, z: 0 } };

test('a prepared purchase reserves progression until commit or cancellation', () => {
  const s = forgeFixture();
  supplyForge(s);
  const before = s.captureSave(),
    tick = s.sim.tick;
  const purchase = s.prepareForgePurchase('bench', 'sword');
  assert.throws(() => s.salvage('iron'), /loading|purchase/);
  assert.throws(() => s.dismissLesson('sword'), /loading|purchase/);
  assert.deepEqual(s.step({ ...idle, move: { x: 1, z: 0 } }), { events: [] });
  assert.equal(s.sim.tick, tick);
  assert.deepEqual(s.captureSave(), before);
  const exported = purchase.save;
  exported.adventure!.inventory.gold = 999;
  assert.equal(purchase.save.adventure!.inventory.gold, 8, 'candidate writes are detached');
  purchase.commit();
  assert.equal(s.inventory.gold, 8);
});

test('purchase cancellation restores progression without cancelling a successor room plan', () => {
  const s = forgeFixture();
  supplyForge(s);
  const before = s.captureSave();
  const cancelled = s.prepareForgePurchase('bench', 'sword');
  cancelled.cancel();
  cancelled.cancel();
  assert.throws(() => cancelled.commit(), /Stale/);
  assert.deepEqual(s.captureSave(), before);
  s.dismissLesson('sword');
  const superseded = s.prepareForgePurchase('bench', 'lantern');
  const room = s.prepareReset();
  superseded.cancel();
  assert.equal(s.loading, true);
  s.commitRoom(room);
  assert.throws(() => superseded.commit(), /Stale/);
  assert.equal(s.forgeUpgrade, undefined);
  assert.equal(s.loading, false);
});

for (const choice of ['sword', 'lantern'] as const) {
  test(`${choice} purchase atomically spends the unique temper and survives reload, rest and death`, () => {
    const s = forgeFixture();
    s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 10000);
    Object.assign(s.sim.hero, { x: 1, z: 0 });
    assert.equal(s.sim.openContainer('cache'), true);
    for (const drop of [...s.sim.drops]) assert.equal(s.sim.collectDrop(drop.id), true);
    const before = s.captureSave();
    const purchase = s.prepareForgePurchase('bench', choice);
    assert.deepEqual(s.captureSave(), before, 'preparing or cancelling spends nothing');
    const codec = new StorageCodec(s.registry);
    const durable = codec.snapshot('game', purchase.save);
    purchase.commit();
    assert.deepEqual(s.inventory, {
      ...before.adventure!.inventory,
      gold: 0,
      iron: 2,
      'workshop-temper': 0,
    });
    assert.equal(s.forgeUpgrade, choice);
    assert.throws(() => purchase.commit(), /Stale/);
    assert.throws(
      () => s.prepareForgePurchase('bench', choice === 'sword' ? 'lantern' : 'sword'),
      /already/,
    );
    const restored = new GameSession(s.registry);
    restored.restoreSave(durable);
    assert.equal(restored.forgeUpgrade, choice);
    assert.deepEqual(restored.inventory, s.inventory);
    for (const reset of ['rest', 'death'] as const) {
      Object.assign(restored.sim.hero, { x: -5, z: 0, health: reset === 'death' ? 0 : 50 });
      if (reset === 'rest') restored.rest('forge/rest');
      else restored.resetCurrentArea('death');
      assert.equal(restored.forgeUpgrade, choice);
      assert.deepEqual(restored.inventory, s.inventory);
      assert.ok(restored.sim.claimedObjects.has('cache'));
      assert.equal(
        restored.sim.drops.some((d) => d.rewards.some((r) => r.item === 'workshop-temper')),
        false,
      );
      Object.assign(restored.sim.hero, { x: 1, z: 0 });
      assert.equal(restored.sim.openContainer('cache'), false);
    }
    assert.deepEqual(codec.decode('game', JSON.stringify({ ...durable, version: 8 })), {
      status: 'empty',
      reason: 'incompatible',
    });
  });

  test(`${choice} scales sword impacts, lantern hit and all three Burn ticks independently`, () => {
    const s = forgeFixture();
    supplyForge(s);
    s.prepareForgePurchase('bench', choice).commit();
    const target = s.sim.enemies[0]!;
    const attributes = kitAttributes(choice);
    for (const attack of ['sweep', 'lunge'] as const) {
      Object.assign(target, { x: 1, z: 0, health: 1000, stun: 1000 });
      s.sim.hero.aim = Math.PI / 2;
      s.sim.startSword(s.sim.hero, attack);
      s.sim.hero.age = attackDefinition(s.sim.hero).windup;
      const events = s.step(idle).events.filter((e) => e.kind === 'damage');
      assert.equal(events.length, 1);
      assert.equal(events[0]!.amount, choice === 'sword' ? 52 : 26);
    }
    Object.assign(target, { x: 1, z: 0, health: 1000, stun: 1000 });
    s.sim.start(s.sim.hero, 'ability');
    s.sim.hero.age = tuning.ability.windup;
    const direct = s.step(idle).events.find((e) => e.kind === 'damage')!;
    assert.equal(direct.amount, choice === 'lantern' ? 32 : 16);
    assert.equal(target.stun, tuning.ability.stun - 1);
    assert.equal(target.burn!.remaining, tuning.ability.burnDuration);
    const ticks = [];
    Object.assign(s.sim.hero, { x: -5, z: 0 });
    for (let i = 0; i < tuning.ability.burnDuration; i++) {
      target.stun = 1000;
      for (const e of s.step(idle).events)
        if (e.kind === 'damage' && e.phase === 'over-time')
          ticks.push({ tick: i + 1, amount: e.amount });
    }
    assert.deepEqual(
      ticks,
      [60, 120, 180].map((tick) => ({ tick, amount: choice === 'lantern' ? 8 : 4 })),
    );
    s.sim.hero.health = 100;
    s.sim.damage(target, s.sim.hero, 8);
    assert.equal(s.sim.hero.health, 92, 'enemy damage is unchanged');
    s.unequip('sword');
    s.unequip('lantern');
    assert.deepEqual(
      kitAttributes(s.forgeUpgrade),
      attributes,
      'upgrades belong to the permanent kit',
    );
  });
}

test('forge admission rejects missing resources, invalid choices and duplicate temper ownership without partial spending', () => {
  for (const missing of ['gold', 'iron', 'workshop-temper']) {
    const owner = new InventoryState({
      inventory: { gold: 20, iron: 4, 'workshop-temper': 1, [missing]: 0 },
      equipment: {},
    });
    const before = owner.snapshot();
    assert.throws(() => owner.prepareForgePurchase('sword'), /Requires/);
    assert.deepEqual(owner.snapshot(), before);
  }
  const s = forgeFixture();
  supplyForge(s);
  const before = s.captureSave();
  assert.throws(() => s.prepareForgePurchase('bench', 'invalid' as 'sword'), /Unknown/);
  assert.deepEqual(s.captureSave(), before);
  for (const change of [
    (save: typeof before) => {
      save.adventure!.inventory['workshop-temper'] = 2;
    },
    (save: typeof before) => {
      save.adventure!.forgeUpgrade = 'sword';
    },
    (save: typeof before) => {
      save.adventure!.forgeUpgrade = 'invalid' as 'sword';
    },
  ]) {
    const save = structuredClone(before);
    change(save);
    assert.throws(() => parseGame(save, s.registry));
  }
  assert.equal(scaledDamage(1, 15), 1);
});

test('workbench commands enforce proximity, line of sight, combat and lifetime admission', () => {
  for (const reason of ['far', 'dead', 'combat', 'wall', 'height'] as const) {
    const s = forgeFixture();
    supplyForge(s);
    if (reason === 'far') s.sim.hero.x = -5;
    if (reason === 'dead') s.sim.hero.health = 0;
    if (reason === 'combat') s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 1);
    if (reason === 'wall' || reason === 'height') {
      // These query fixtures keep gameplay frozen and exercise shared reach admission.
      s.sim.hero.x = 1;
      if (reason === 'height') s.sim.hero.y = 2;
      else {
        const definitions = structuredClone(s.registry.definitions) as ContentDefinitions;
        definitions.areas[0]!.props = [
          {
            id: 'barrier',
            kind: 'wall',
            x: 0.5,
            z: 0,
            radius: 0.1,
            height: 1,
            size: [0.1, 2],
            shape: 'box',
          },
        ];
        const blocked = new GameSession(new ContentRegistry(definitions));
        supplyForge(blocked);
        blocked.sim.hero.x = 1;
        assert.equal(interactionTarget(blocked.sim, 'workbench', 'bench'), undefined);
        assert.throws(() => blocked.prepareForgePurchase('bench', 'sword'), /Visit/);
        continue;
      }
    }
    const before = s.captureSave();
    assert.throws(() => s.prepareForgePurchase('bench', 'sword'), /Visit|combat/);
    assert.deepEqual(s.captureSave(), before);
  }
  const s = forgeFixture();
  supplyForge(s);
  const purchase = s.prepareForgePurchase('bench', 'sword');
  s.resetCurrentArea();
  assert.throws(() => purchase.commit(), /inactive|Stale/);
  assert.equal(s.forgeUpgrade, undefined);
  assert.equal(s.inventory['workshop-temper'], 1);
  assert.equal(s.sim.openContainer('bench'), false);
});

test('content keeps the Workshop Temper unique and excludes repeatable enemy rewards', () => {
  const s = forgeFixture();
  const definitions = structuredClone(s.registry.definitions) as ContentDefinitions;
  definitions.areas[0]!.spawns = [
    { ...definitions.areas[0]!.spawns[0]!, rewards: [{ item: 'workshop-temper', amount: 1 }] },
  ];
  assert.throws(() => new ContentRegistry(definitions), /Enemies/);
  definitions.areas[0]!.spawns = s.registry.definitions.areas[0]!.spawns;
  definitions.areas[0]!.interactables = [
    ...definitions.areas[0]!.interactables!,
    { ...definitions.areas[0]!.interactables![1]!, id: 'duplicate-cache' },
  ];
  assert.throws(() => new ContentRegistry(definitions), /unique container/);
});

test('forge wind guides cache collection, the unused workbench and then the fire', async () => {
  const { windDestination } = await import('../../src/presentation/guiding-wind');
  const definitions = structuredClone(forgeFixture().registry.definitions) as ContentDefinitions;
  definitions.initialArea = 'ruined-forge';
  definitions.areas[0]!.id = 'ruined-forge';
  const s = new GameSession(new ContentRegistry(definitions));
  const cache = s.sim.areaDefinition.interactables![1]!;
  assert.equal(windDestination(s.sim.view), cache);
  s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 10000);
  assert.equal(s.sim.openContainer('cache'), true);
  assert.equal(windDestination(s.sim.view), s.sim.view.drops[0]);
  for (const drop of [...s.sim.drops]) s.sim.collectDrop(drop.id);
  assert.equal(windDestination(s.sim.view), s.sim.areaDefinition.interactables![0]);
  s.prepareForgePurchase('bench', 'sword').commit();
  assert.equal(windDestination(s.sim.view), s.sim.areaDefinition.campfires![0]);
});

test('the first forge choice changes a thrall encounter: one sword impact or one complete Burn', () => {
  for (const choice of [undefined, 'sword', 'lantern'] as const) {
    for (const action of ['sword', 'lantern'] as const) {
      const s = forgeFixture();
      if (choice) {
        supplyForge(s);
        s.prepareForgePurchase('bench', choice).commit();
      }
      const target = s.sim.enemies[0]!;
      Object.assign(target, { x: 1, z: 0, health: 50, stun: 1000 });
      s.sim.hero.aim = Math.PI / 2;
      if (action === 'sword') {
        s.sim.startSword(s.sim.hero, 'sweep');
        s.sim.hero.age = attackDefinition(s.sim.hero).windup;
        s.step(idle);
        assert.equal(target.health, choice === 'sword' ? 0 : 24);
      } else {
        s.sim.start(s.sim.hero, 'ability');
        s.sim.hero.age = tuning.ability.windup;
        s.step(idle);
        assert.ok(target.health > 0, 'the lantern still needs its Burn');
        Object.assign(s.sim.hero, { x: -5, z: 0 });
        for (let tick = 0; tick < tuning.ability.burnDuration; tick++) {
          target.stun = 1000;
          s.step(idle);
        }
        assert.equal(target.health, choice === 'lantern' ? 0 : 22);
      }
    }
  }
});
