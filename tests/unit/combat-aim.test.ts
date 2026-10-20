import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { content } from '../fixtures/content';
import { boxProp } from '../fixtures/world';
import { mockGlobals } from '../fixtures/globals';
import { Simulation } from '../../src/core/simulation';
import { Input } from '../../src/input';
import { makeCamera, walkablePoint } from '../../src/presentation/camera';
import { enemyAimPoint } from '../../src/presentation/combat-aim';
import { attackDefinition } from '../../src/content/gameplay';

const rect = { left: 80, top: 70, width: 1280, height: 800, right: 1360, bottom: 870 };
const camera = makeCamera(rect.width / rect.height);
function cursor(x: number, y: number, z: number) {
  const p = new Vector3(x, y, z).project(camera);
  return {
    x: rect.left + ((p.x + 1) * rect.width) / 2,
    y: rect.top + ((1 - p.y) * rect.height) / 2,
  };
}
function duel() {
  const sim = new Simulation(content);
  Object.assign(sim.hero, { x: 0, z: 0, y: 0, nextAttack: 'lunge' });
  const enemy = sim.enemies[0]!;
  sim.actors = [sim.hero, enemy];
  Object.assign(enemy, { x: 1.2, z: 0, y: 0, stun: 10000, health: 100 });
  return { sim, enemy };
}

test('clicking an enemy torso lands a lunge in every direction while floor projection can aim behind the hero', (t) => {
  mockGlobals(t, { window: new EventTarget(), document: new EventTarget() });
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => rect });
  const input = new Input(canvas as unknown as HTMLCanvasElement, camera, () => {});
  t.after(() => input.dispose());
  for (let i = 0; i < 8; i++) {
    const { sim, enemy } = duel();
    enemy.x = Math.sin((i * Math.PI) / 4) * 1.2;
    enemy.z = Math.cos((i * Math.PI) / 4) * 1.2;
    const pointer = cursor(enemy.x, 1.1, enemy.z);
    canvas.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        button: 0,
        clientX: pointer.x,
        clientY: pointer.y,
      }),
    );
    const command = input.consume(sim.hero, sim.areaDefinition, sim.generation, sim.enemies);
    assert.deepEqual(command.aim, { x: enemy.x, z: enemy.z });
    sim.step(command);
    const timing = attackDefinition(sim.hero);
    for (let tick = 0; tick < timing.activeEnd; tick++)
      sim.step({ move: { x: 0, z: 0 }, aim: command.aim });
    assert.equal(enemy.health, 74, `lunge toward direction ${i}`);
  }
  const p = cursor(1.2, 1.1, 0);
  const floor = walkablePoint(camera, p.x, p.y, rect, content.area('court'))!;
  assert.ok(floor.z < -1, 'the former floor-only aim goes behind the nearby target');
});

test('body aiming preserves free ground aim and ignores dead, obstructed and different-floor targets', () => {
  const { sim, enemy } = duel();
  const pointer = cursor(enemy.x, 1.1, enemy.z);
  const pick = () =>
    enemyAimPoint(camera, pointer, rect, sim.hero, sim.enemies, sim.areaDefinition);
  assert.deepEqual(pick(), { x: enemy.x, z: enemy.z });
  assert.equal(
    enemyAimPoint(camera, cursor(-3, 0, 3), rect, sim.hero, sim.enemies, sim.areaDefinition),
    undefined,
  );
  enemy.health = 0;
  assert.equal(pick(), undefined);
  enemy.health = 100;
  enemy.y = 2;
  assert.equal(pick(), undefined);
  enemy.y = 0;
  const blocked = {
    ...sim.areaDefinition,
    props: [boxProp({ id: 'wall', x: 0.6, size: [0.1, 4] })],
  };
  assert.equal(enemyAimPoint(camera, pointer, rect, sim.hero, sim.enemies, blocked), undefined);
});

test('body aiming follows the head of a larger enemy visual', () => {
  const { sim, enemy } = duel();
  const pointer = cursor(enemy.x, 2.2, enemy.z);
  const pick = () =>
    enemyAimPoint(camera, pointer, rect, sim.hero, sim.enemies, sim.areaDefinition);
  assert.equal(pick(), undefined, 'the ordinary silhouette does not capture empty space above it');
  enemy.definition = { ...enemy.definition, visual: 'chapel-warden' };
  assert.deepEqual(pick(), { x: enemy.x, z: enemy.z });
});

test('a ray parallel to flat ground returns its coplanar crossing instead of null', async () => {
  const { OrthographicCamera } = await import('three');
  const area = content.area('court');
  const horizontal = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  horizontal.position.set(0, 0, 5);
  horizontal.lookAt(0, 0, 0);
  horizontal.updateMatrixWorld();
  const flatRect = { left: 0, top: 0, width: 800, height: 450 };
  const point = walkablePoint(horizontal, 400, 225, flatRect, area);
  assert.ok(point, 'coplanar horizontal ray must hit flat ground');
  assert.ok(Math.abs(point!.y) < 1e-9);
});
