import { rectangle } from '../fixtures/ground';
import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import { boundaryContains, clampToBoundary, supportedPosition } from '../../src/content/world';
import { cameraContract } from '../../src/assets/camera-contract';

test('single paintings cover one complete image and retain the displayed aspect ratio', () => {
  const layout = artworkFloorLayout(6, 4),
    yaw = (cameraContract.azimuthDeg * Math.PI) / 180,
    elevation = (cameraContract.elevationDeg * Math.PI) / 180;
  const projected = layout.corners.map((p) => ({
    x: p.x * Math.cos(yaw) - p.z * Math.sin(yaw),
    y: (p.x * Math.sin(yaw) + p.z * Math.cos(yaw)) * Math.sin(elevation),
  }));
  const width = Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x));
  const height = Math.max(...projected.map((p) => p.y)) - Math.min(...projected.map((p) => p.y));
  assert.ok(Math.abs(width / height - 1.5) < 1e-10);
  for (const [i, p] of layout.corners.entries()) {
    const [u, v] = layout.uv(p),
      expected = rectangle(0, 0, 1, 1)[i]!;
    assert.ok(Math.abs(u - expected[0]!) < 1e-10 && Math.abs(v - expected[1]!) < 1e-10);
  }
  for (const p of [
    { x: 100, z: 100 },
    { x: -100, z: 40 },
    { x: 30, z: -80 },
  ]) {
    const supported = clampToBoundary(layout.corners, p, 0.3);
    assert.ok(boundaryContains(layout.corners, supported, 0.3));
  }
});

import { Vector3 } from 'three';
import {
  constrainCamera,
  makeCamera,
  resizeCamera,
  outward,
  groundPoint,
} from '../../src/presentation/camera';
import { resolveScene } from '../../src/content/world-art';
import { emptyScene } from '../../src/editor/default-scene';

test('authored hero composition bias defaults on', () => {
  const document = emptyScene();
  delete document.camera.keepHeroVisible;
  assert.equal(resolveScene(document).visuals.camera.keepHeroVisible, true);
  document.camera.keepHeroVisible = false;
  assert.equal(resolveScene(document).visuals.camera.keepHeroVisible, false);
});

test('camera keeps all four viewport corners on the floor at every edge, aspect and zoom', () => {
  for (const layout of [undefined, 'artwork'] as const) {
    const document = emptyScene();
    document.floor.layout = layout;
    document.floor.width = 6;
    document.floor.depth = 4;
    const { area } = resolveScene(document);
    for (const [width, height] of [
      [1600, 900],
      [900, 1600],
      [3000, 500],
      [1500, 500],
    ])
      for (const span of [2, 4, 9, 30])
        for (const p of [{ x: 0, z: 0 }, ...artworkFloorLayout(6, 4).corners]) {
          const hero = supportedPosition(area, p, 0.3),
            target = new Vector3(hero.x, 1.7, hero.z),
            camera = makeCamera(width! / height!);
          resizeCamera(camera, width!, height!, span);
          constrainCamera(camera, target, area);
          camera.position.copy(target).addScaledVector(outward, 30);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          for (const x of [0, width!])
            for (const y of [0, height!]) {
              const corner = groundPoint(camera, x, y, {
                left: 0,
                top: 0,
                width: width!,
                height: height!,
              })!;
              assert.ok(corner);
              corner.addScaledVector(outward, -0.01 / outward.y);
              assert.ok(corner.x >= area.bounds.minX - 1e-8 && corner.x <= area.bounds.maxX + 1e-8);
              assert.ok(corner.z >= area.bounds.minZ - 1e-8 && corner.z <= area.bounds.maxZ + 1e-8);
              if (area.sceneBoundary) assert.ok(boundaryContains(area.sceneBoundary, corner));
            }
          // Moving away from a small floor must release its temporary zoom constraint.
          resizeCamera(camera, width!, height!, 0.5);
          constrainCamera(camera, target, area);
          assert.equal(camera.zoom, 1);
        }
  }
});

// Exercise the actual authored scene dimensions, including destinations outside
// the playable margin, rather than accepting a dark fill behind the artwork.
import fs from 'node:fs';
import { tuning } from '../../src/content/gameplay';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { content } from '../../src/content/game-content';

test('every authored painting frames reachable edge poses without exposing the scene', () => {
  const directory = new URL('../../authoring/scenes/', import.meta.url);
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const { area } = resolveScene(JSON.parse(fs.readFileSync(new URL(file, directory), 'utf8')));
    for (const aspect of [9 / 16, 16 / 9, 21 / 9, 6])
      for (const span of [8.55, 15])
        for (const p of [
          ...area.sceneBoundary!,
          ...area.entries,
          ...area.exits.map((e) => e.marker!),
        ]) {
          const hero = supportedPosition(area, p, 0.3),
            position = new Vector3(hero.x, 0, hero.z),
            target = position.clone().add(new Vector3(0, 1.7, 0)),
            camera = makeCamera(aspect),
            height = cameraContract.heroHeight * tuning.heroVisualScale;
          resizeCamera(camera, aspect * 900, 900, span);
          constrainCamera(camera, target, area, { position, height });
          camera.position.copy(target).addScaledVector(outward, 30);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          for (const p of [position, position.clone().add(new Vector3(0, height, 0))]) {
            const screen = p.clone().project(camera);
            assert.ok(
              Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1,
              `${file}: hero outside ${aspect} / ${span}`,
            );
          }
          assert.ok(
            position
              .clone()
              .add(new Vector3(0, height, 0))
              .project(camera).y <=
              0.76 + 1e-7,
            `${file}: head behind controls`,
          );
          for (const x of [0, aspect * 900])
            for (const y of [0, 900]) {
              const corner = groundPoint(camera, x, y, {
                left: 0,
                top: 0,
                width: aspect * 900,
                height: 900,
              })!;
              corner.addScaledVector(outward, -0.01 / outward.y);
              assert.ok(
                boundaryContains(area.sceneBoundary!, corner),
                `${file}: artwork edge exposed`,
              );
            }
        }
  }
});

test('checkpoints at an old scene edge move onto clear framed ground', () => {
  const session = new GameSession(content, 142, 'ruined-forge'),
    save = session.captureSave();
  Object.assign(save.player, { x: -1.478048, z: -11.790022 });
  const area = content.area(save.area),
    spawn = area.spawns[0]!,
    state = save.areas[save.area]!;
  Object.assign(state.actors[spawn.id]!, { x: save.player.x, z: save.player.z, health: 0 });
  state.drops = [
    {
      id: `enemy-${spawn.id}-0`,
      source: spawn.id,
      enemy: true,
      x: save.player.x,
      z: save.player.z,
      rewards: [structuredClone(spawn.rewards![0]!)],
    },
  ];
  const restored = parseGame(save, content);
  assert.notDeepEqual(restored.player, save.player);
  assert.ok(boundaryContains(content.area(save.area).playableBoundary!, restored.player, 0.3));
  assert.ok(
    boundaryContains(area.playableBoundary!, restored.areas[save.area]!.actors[spawn.id]!, 0.3),
  );
  assert.ok(boundaryContains(area.playableBoundary!, restored.areas[save.area]!.drops![0]!, 0.01));
  assert.equal(restored.areas[save.area]!.actors[spawn.id]!.health, 0);
  assert.deepEqual(restored.adventure, save.adventure);
  const blocked = structuredClone(save);
  Object.assign(blocked.player, { x: 1000, z: 1000 });
  assert.throws(() => parseGame(blocked, content), /invalid player state/);
});
