import { boxProp, interactable } from '../fixtures/world';
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentDefinitions } from '../fixtures/content';
import { ContentRegistry } from '../../src/content/world';
import { GameSession } from '../../src/core/session';
import { PickupPlan } from '../../src/core/pickup-plan';
import { parseGame } from '../../src/core/save';
import { footstepClip, heroFootContacts } from '../../src/content/footsteps';
import { Animator } from '../../src/core/animation';
import { tuning, flareLightEnvelope } from '../../src/content/gameplay';
import { FixedClock } from '../../src/core/simulation';
import { content as productionContent } from '../../src/content/game-content';
import { Navigation } from '../../src/core/navigation';
import { effectiveRadius } from '../../src/content/collision';

const idle = { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } };
function fixture(blocked = false) {
  const base = contentDefinitions.areas[0]!;
  const registry = new ContentRegistry({
    ...contentDefinitions,
    areas: [
      {
        ...base,
        entries: [{ id: 'start', x: -3, z: 0 }],
        activation: undefined,
        exits: [],
        spawns: [],
        props: blocked
          ? [boxProp({ id: 'divider', size: [0.8, 30], height: 2, radius: 0.2, blocking: true })]
          : [],
        interactables: [
          interactable({
            id: 'cache',
            object: 'cache',
            x: 3,
            spent: 'spent',
            rewards: [
              { item: 'gold', amount: 5 },
              { item: 'health-potion', amount: 1 },
            ],
          }),
        ],
      },
    ],
  });
  const session = new GameSession(registry);
  session.sim.hero.x = 3;
  session.sim.openContainer('cache');
  session.sim.hero.x = -3;
  session.sim.hero.px = -3;
  return session;
}
test('labels collect independent stacks; a partial cache survives checkpoint restore', () => {
  const session = fixture(),
    plan = new PickupPlan();
  assert.equal(session.sim.drops.length, 2);
  assert.equal(plan.request(session.sim, 'object-cache-0'), true);
  let ready: string | undefined;
  for (let i = 0; i < 150 && !ready; i++) {
    session.step(idle);
    ready = plan.ready(session.sim);
  }
  assert.equal(ready, 'object-cache-0');
  assert.equal(session.sim.collectDrop(ready!), true);
  assert.equal(session.inventory.gold, 5);
  assert.equal(session.inventory['health-potion'], undefined);
  const saved = parseGame(session.captureSave(), session.registry);
  const restored = fixture();
  restored.restoreSave(saved);
  assert.deepEqual(
    restored.sim.drops.map((d) => d.id),
    ['object-cache-1'],
  );
  assert.equal(restored.sim.collectDrop('object-cache-0'), false);
  assert.equal(restored.sim.collectDrop('object-cache-1'), true);
});
test('pickup routing cancels on explicit movement and rejects unreachable or stale identities', () => {
  const session = fixture(),
    plan = new PickupPlan();
  assert.equal(plan.request(session.sim, 'object-cache-0'), true);
  plan.beforeStep(session.sim, { ...idle, move: { x: 0, z: 1 } });
  assert.equal(session.sim.navigationDebug(false).routes.length, 0);
  assert.equal(plan.ready(session.sim), undefined);
  assert.equal(plan.request(fixture(true).sim, 'object-cache-0'), false);
  assert.equal(plan.request(session.sim, 'object-cache-999'), false);
  const forged = session.captureSave();
  forged.areas.court!.drops![0]!.rewards[0]!.amount++;
  assert.throws(() => parseGame(forged, session.registry), /Invalid drop/);
});
test('foot contacts follow retimed drawings and seeking/heading phase changes are silent', () => {
  for (const [heading, contacts] of Object.entries(heroFootContacts)) {
    const count = heading === 'd45' ? 6 : heading === 'd00' ? 7 : 8;
    const clip = footstepClip(
      {
        frames: Array.from({ length: count }, (_, i) => String(i)),
        durationsMs: Array.from({ length: count }, (_, i) => 60 + i * 10),
        loop: true,
        notifies: [],
      },
      heading as keyof typeof heroFootContacts,
    );
    const animator = new Animator('hero', clip);
    for (const [i, frame] of contacts.entries())
      assert.equal(
        clip.notifies[i]!.atMs,
        clip.durationsMs.slice(0, frame).reduce((a, b) => a + b, 0),
      );
    const duration = clip.durationsMs.reduce((a, b) => a + b, 0);
    assert.equal(animator.advance(duration - 1).length, 2);
    animator.seek(duration * 2 + 1);
    assert.equal(animator.advance(1).length, 0);
  }
});
test('flare light rises before damage and fades rapidly without changing damage time', () => {
  assert.equal(flareLightEnvelope(-101), 0);
  assert.equal(flareLightEnvelope(-50), 0.5);
  assert.equal(flareLightEnvelope(0), 1);
  assert.equal(flareLightEnvelope(125), 0.25);
  assert.equal(flareLightEnvelope(250), 0);
});
test('irregular render intervals preserve constant interpolated open-ground velocity', () => {
  const clock = new FixedClock();
  let previous = 0,
    current = 0,
    elapsed = 0;
  for (const ms of [17, 12, 19, 8, 24, 16, 10, 20, 15, 17]) {
    elapsed += ms;
    const alpha = clock.advance(ms, () => {
      previous = current;
      current += tuning.moveSpeed / 60;
    });
    assert.ok(
      Math.abs(
        previous +
          (current - previous) * alpha -
          (Math.max(0, elapsed - 1000 / 60) * tuning.moveSpeed) / 1000,
      ) < 1e-8,
    );
  }
});

test('the expanded Orchard connects every encounter, supply and required destination', () => {
  const area = productionContent.area('abandoned-orchard');
  const nav = new Navigation(area);
  const radius = effectiveRadius(productionContent.actor('lamplighter').radius);
  const start = area.entries.find((p) => p.id === area.baselineEntry)!;
  for (const point of [
    ...area.spawns,
    ...area.interactables!,
    ...area.campfires!,
    ...area.exits.map((e) => e.marker),
  ])
    assert.equal(
      nav.route(start, point, radius).status,
      'ready',
      'Route to ' + ('id' in point ? point.id : 'exit'),
    );
});
