import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type ActorDefinition } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';
import { emptyScene } from '../../src/editor/default-scene';
import { GameSession } from '../../src/core/session';

test('assertActor rejects invalid attack kinds with explicit error', () => {
  const badAttackKind: ActorDefinition = {
    ...structuredClone(contentDefinitions.actors[0]!),
    id: 'bad-attack-actor',
    attack: {
      kind: 'ranged',
      windup: 10,
      activeEnd: 20,
      total: 30,
      range: 5,
      damage: 10,
    } as unknown as ActorDefinition['attack'],
  };
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        actors: [...contentDefinitions.actors, badAttackKind],
      }),
    /invalid attack kind bad-attack-actor/,
  );

  // Valid melee actor passes
  const validMelee: ActorDefinition = {
    ...structuredClone(contentDefinitions.actors[0]!),
    id: 'valid-melee-actor',
    attack: {
      kind: 'melee',
      windup: 10,
      activeEnd: 20,
      total: 30,
      range: 2,
      damage: 10,
      halfAngle: Math.PI / 4,
    },
  };
  assert.doesNotThrow(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        actors: [...contentDefinitions.actors, validMelee],
      }),
  );
});

test('SceneDocumentSchema rejects paths with 0 control points or mismatched widths', () => {
  const doc = emptyScene();

  // 0 control points must be rejected
  const emptyPathDoc: SceneDocument = {
    ...doc,
    paths: [
      {
        points: [],
        width: 1,
      },
    ],
  };
  assert.throws(() => parseSceneDocument(emptyPathDoc));

  // Mismatched widths array length must be rejected
  const mismatchedWidthsDoc: SceneDocument = {
    ...doc,
    paths: [
      {
        points: [
          { x: 0, z: 0 },
          { x: 2, z: 2 },
          { x: 4, z: 4 },
        ],
        width: 1,
        widths: [1, 2], // 2 widths for 3 points
      },
    ],
  };
  assert.throws(
    () => parseSceneDocument(mismatchedWidthsDoc),
    /Route width is registered at every control point/,
  );

  // Matching widths array passes
  const validWidthsDoc: SceneDocument = {
    ...doc,
    paths: [
      {
        points: [
          { x: 0, z: 0 },
          { x: 2, z: 2 },
        ],
        width: 1,
        widths: [1, 2],
      },
    ],
  };
  assert.doesNotThrow(() => parseSceneDocument(validWidthsDoc));

  // Omitted widths passes
  const validUniformDoc: SceneDocument = {
    ...doc,
    paths: [
      {
        points: [
          { x: 0, z: 0 },
          { x: 2, z: 2 },
        ],
        width: 1,
      },
    ],
  };
  assert.doesNotThrow(() => parseSceneDocument(validUniformDoc));
});

test('session prepareRestore defaults nextAttack to sweep when omitted from player save', () => {
  const registry = new ContentRegistry(contentDefinitions);
  const session = new GameSession(registry);
  const save = session.captureSave();

  // Explicitly remove optional nextAttack
  delete save.player.nextAttack;
  session.restoreSave(save);

  assert.equal(session.sim.hero.nextAttack, 'sweep');

  // Next attack with sword performs sweep and queues lunge
  session.sim.startSword(session.sim.hero);
  assert.equal(session.sim.hero.attackKind, 'sweep');
  assert.equal(session.sim.hero.nextAttack, 'lunge');

  // Restoring with explicit lunge preserves lunge
  save.player.nextAttack = 'lunge';
  session.restoreSave(save);
  assert.equal(session.sim.hero.nextAttack, 'lunge');
});
