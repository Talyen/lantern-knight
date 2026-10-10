import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { content, gameScenes, gameAssetCatalog } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { checkSceneDocuments } from '../../tools/check-scene-documents';

const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } };
test('empty Game stays playable and saveable without spurious victories or transitions', () => {
  const session = new GameSession(content);
  let victories = 0;
  for (let i = 0; i < 600; i++) {
    const result = session.step({
      ...still,
      move: { x: 1, z: 0 },
      attack: i % 60 === 0,
      ability: i === 0,
      dodge: i === 100,
    });
    victories += result.events.filter((e) => e.kind === 'room-clear').length;
    assert.equal(result.transition, undefined);
  }
  assert.ok(session.sim.hero.x > 0);
  assert.ok(
    session.sim.hero.x <=
      session.sim.areaDefinition.bounds.maxX - session.sim.hero.definition.radius,
  );
  assert.equal(session.sim.hero.health, 100);
  assert.equal(victories, 0);
  assert.equal(session.wins, 0);
  const save = parseGame(session.captureSave(), content);
  const restored = new GameSession(content);
  restored.restoreSave(save);
  assert.equal(restored.sim.hero.x, session.sim.hero.x);
  restored.resetCurrentArea();
  assert.equal(restored.sim.hero.x, 0);
  assert.equal(restored.sim.hero.z, 0);
  const scene = gameScenes.area('empty');
  assert.equal(scene.visuals, undefined);
  assert.deepEqual(scene.assets, []);
  assert.equal('ink-moss' in gameAssetCatalog, false);
  for (const id of gameScenes.initialAssets) assert.ok(gameAssetCatalog[id]);
  assert.throws(() => parseGame({ ...save, area: 'court' }, content), /unknown area/);
});
test('scene validation accepts an absent or empty authoring directory but rejects malformed documents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-empty-scenes-'));
  try {
    assert.equal(await checkSceneDocuments(root, root), 0);
    const directory = path.join(root, 'authoring/scenes');
    await fs.mkdir(directory, { recursive: true });
    assert.equal(await checkSceneDocuments(root, root), 0);
    await fs.writeFile(path.join(directory, 'broken.json'), '{}');
    await assert.rejects(checkSceneDocuments(root, root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
