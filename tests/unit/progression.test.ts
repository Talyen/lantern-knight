import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeFixture, supplyUpgrades } from '../fixtures/upgrades';
import { GameSession } from '../../src/core/session';
import { InventoryState } from '../../src/core/inventory';
import { kitAttributes, scaledDamage } from '../../src/content/progression';
import { tuning, attackDefinition } from '../../src/content/gameplay';
import { parseGame } from '../../src/core/save';
import { StorageCodec } from '../../src/platform/storage-codec';
import { ContentRegistry, type ContentDefinitions } from '../../src/content/world';
const idle = { move: { x: 0, z: 0 }, aim: { x: 4, z: 0 } };

test('a prepared improvement reserves progression, exports detached data and is single use', () => {
  const s = upgradeFixture();
  supplyUpgrades(s);
  const before = s.captureSave(),
    tick = s.sim.tick;
  const purchase = s.prepareUpgradePurchase('camp/arrival', 'sword');
  assert.throws(() => s.changeInventory({ kind: 'salvage', item: 'iron' }), /loading/);
  assert.throws(() => s.dismissLesson('sword'), /loading/);
  assert.deepEqual(s.step({ ...idle, move: { x: 1, z: 0 } }), { events: [] });
  assert.equal(s.sim.tick, tick);
  assert.deepEqual(s.captureSave(), before);
  purchase.save.adventure!.upgrades!.sword = 99;
  assert.deepEqual(purchase.save.adventure!.upgrades, { sword: 1 });
  purchase.commit();
  assert.deepEqual(s.upgrades, { sword: 1 });
  assert.equal(s.inventory.gold, 8);
  assert.throws(() => purchase.commit(), /Stale/);
});

test('cancellation preserves resources and cannot cancel a successor room plan', () => {
  const s = upgradeFixture();
  supplyUpgrades(s);
  const before = s.captureSave();
  const cancelled = s.prepareUpgradePurchase('camp/arrival', 'sword');
  cancelled.cancel();
  cancelled.cancel();
  assert.throws(() => cancelled.commit(), /Stale/);
  assert.deepEqual(s.captureSave(), before);
  const superseded = s.prepareUpgradePurchase('camp/arrival', 'lantern');
  const room = s.prepareReset();
  superseded.cancel();
  assert.equal(s.loading, true);
  s.commitRoom(room);
  assert.throws(() => superseded.commit(), /Stale/);
  assert.deepEqual(s.upgrades, {});
});

for (const choice of ['sword', 'lantern'] as const) {
  test(`${choice} persists through rest, death and reload without healing or resetting encounters on purchase`, () => {
    const s = upgradeFixture();
    supplyUpgrades(s);
    s.sim.hero.health = 45;
    s.sim.enemies[0]!.health = 0;
    const before = s.sim.captureAreaState();
    const purchase = s.prepareUpgradePurchase('camp/arrival', choice);
    const codec = new StorageCodec(s.registry);
    const durable = codec.snapshot('game', purchase.save);
    purchase.commit();
    assert.equal(s.sim.hero.health, 45);
    assert.deepEqual(s.sim.captureAreaState(), before);
    assert.equal(s.inventory.gold, 8);
    assert.equal(s.inventory.iron, 6);
    assert.throws(() => s.prepareUpgradePurchase('camp/arrival', choice), /Maximum rank/);
    const restored = new GameSession(s.registry);
    restored.restoreSave(durable);
    for (const reset of ['rest', 'death'] as const) {
      Object.assign(restored.sim.hero, { x: -5, z: 0, health: reset === 'death' ? 0 : 50 });
      if (reset === 'rest') restored.rest('camp/rest');
      else restored.resetCurrentArea('death');
      assert.deepEqual(restored.upgrades, { [choice]: 1 });
      assert.deepEqual(restored.inventory, s.inventory);
    }
    assert.deepEqual(codec.decode('game', JSON.stringify({ ...durable, version: 10 })), {
      status: 'empty',
      reason: 'incompatible',
    });
  });
}

for (const first of ['sword', 'lantern'] as const) {
  test(`${first} first: purchases share one kit across fires in unrelated scenes`, () => {
    const clearing = upgradeFixture('clearing').registry.definitions;
    const crypt = upgradeFixture('crypt').registry.definitions;
    const s = new GameSession(
      new ContentRegistry({ ...clearing, areas: [...clearing.areas, ...crypt.areas] }),
    );
    supplyUpgrades(s);
    const supplied = s.captureSave();
    supplied.adventure!.inventory.gold = 40;
    supplied.adventure!.inventory.iron = 8;
    delete supplied.adventure!.pack;
    s.restoreSave(supplied);
    s.discoverFire('clearing/arrival');
    assert.throws(() => s.prepareUpgradePurchase('crypt/rest', first), /Visit/);
    s.prepareUpgradePurchase('clearing/arrival', first).commit();
    s.commitRoom(s.prepareFireTravel('crypt/rest'));
    assert.deepEqual(s.upgrades, { [first]: 1 });
    s.prepareUpgradePurchase('crypt/rest', first === 'sword' ? 'lantern' : 'sword').commit();
    assert.deepEqual(s.upgrades, { sword: 1, lantern: 1 });
    assert.deepEqual(kitAttributes(s.upgrades), { edge: 200, ember: 200 });
    s.changeInventory({ kind: 'unequip', slot: 'sword' });
    s.changeInventory({ kind: 'unequip', slot: 'lantern' });
    assert.deepEqual(kitAttributes(s.upgrades), { edge: 200, ember: 200 });
    s.commitRoom(s.prepareFireTravel('clearing/arrival'));
    const restored = new GameSession(s.registry);
    restored.restoreSave(s.captureSave());
    assert.deepEqual(restored.upgrades, { sword: 1, lantern: 1 });
    assert.equal(restored.inventory.gold, 0);
    assert.equal(restored.inventory.iron, 0);
    assert.ok(Object.isFrozen(restored.upgrades));
  });
}

test('admission rejects invalid ranks, inherited IDs and missing materials without partial spending', () => {
  for (const missing of ['gold', 'iron']) {
    const owner = new InventoryState({
      inventory: { gold: 20, iron: 4, [missing]: 0 },
      equipment: {},
    });
    const before = owner.snapshot();
    assert.throws(() => owner.prepareUpgradePurchase('sword'), /Requires/);
    assert.deepEqual(owner.snapshot(), before);
  }
  const s = upgradeFixture();
  supplyUpgrades(s);
  assert.throws(
    () => s.prepareUpgradePurchase('camp/arrival', 'constructor' as 'sword'),
    /Unknown/,
  );
  for (const ranks of [
    { sword: 2 },
    { sword: 0 },
    { sword: -1 },
    { sword: 0.5 },
    { constructor: 1 },
  ] as Record<string, number>[]) {
    const save = s.captureSave();
    save.adventure!.upgrades = ranks;
    assert.throws(() => parseGame(save, s.registry));
  }
  assert.equal(scaledDamage(1, 15), 1);
});

test('campfire purchases enforce identity, proximity, line of sight, elevation, combat and lifetime', () => {
  for (const reason of ['far', 'dead', 'combat', 'wall', 'height', 'foreign-fire'] as const) {
    const source = upgradeFixture();
    const definitions = structuredClone(source.registry.definitions) as ContentDefinitions;
    if (reason === 'combat') definitions.areas[0]!.campfires![0]!.safeRadius = 0.5;
    if (reason === 'wall')
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
    const s = new GameSession(new ContentRegistry(definitions));
    supplyUpgrades(s);
    if (reason === 'far') s.sim.hero.x = -5;
    if (reason === 'dead') s.sim.hero.health = 0;
    if (reason === 'combat') {
      s.sim.hero.x = 1;
      s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 1);
    }
    if (reason === 'height') s.sim.hero.y = 2;
    if (reason === 'wall') s.sim.hero.x = 1;
    const before = s.captureSave();
    assert.throws(() =>
      s.prepareUpgradePurchase(
        reason === 'foreign-fire' ? 'missing/arrival' : 'camp/arrival',
        'sword',
      ),
    );
    assert.deepEqual(s.captureSave(), before);
  }
  const s = upgradeFixture();
  supplyUpgrades(s);
  const purchase = s.prepareUpgradePurchase('camp/arrival', 'sword');
  s.resetCurrentArea();
  assert.throws(() => purchase.commit(), /inactive|Stale/);
  assert.deepEqual(s.upgrades, {});
});

for (const ranks of [{}, { sword: 1 }, { lantern: 1 }, { sword: 1, lantern: 1 }]) {
  test(`damage independently applies purchased ranks ${JSON.stringify(ranks)}`, () => {
    const s = upgradeFixture();
    supplyUpgrades(s);
    const saved = s.captureSave();
    saved.adventure!.upgrades = ranks;
    s.restoreSave(saved);
    const target = s.sim.enemies[0]!;
    for (const attack of ['sweep', 'lunge'] as const) {
      Object.assign(target, { x: 1, z: 0, health: 1000, stun: 1000 });
      s.sim.hero.aim = Math.PI / 2;
      s.sim.startSword(s.sim.hero, attack);
      s.sim.hero.age = attackDefinition(s.sim.hero).windup;
      const hit = s.step(idle).events.find((e) => e.kind === 'damage')!;
      assert.equal(hit.amount, ranks.sword ? 52 : 26);
    }
    Object.assign(target, { x: 1, z: 0, health: 1000, stun: 1000 });
    s.sim.start(s.sim.hero, 'ability');
    s.sim.hero.age = tuning.ability.windup;
    assert.equal(
      s.step(idle).events.find((e) => e.kind === 'damage')!.amount,
      ranks.lantern ? 32 : 16,
    );
    assert.equal(target.stun, tuning.ability.stun - 1);
    const ticks: { tick: number; amount: number }[] = [];
    Object.assign(s.sim.hero, { x: -5, z: 0 });
    for (let i = 0; i < tuning.ability.burnDuration; i++) {
      target.stun = 1000;
      for (const e of s.step(idle).events)
        if (e.kind === 'damage' && e.phase === 'over-time')
          ticks.push({ tick: i + 1, amount: e.amount });
    }
    assert.deepEqual(
      ticks,
      [60, 120, 180].map((tick) => ({ tick, amount: ranks.lantern ? 8 : 4 })),
    );
  });
}
