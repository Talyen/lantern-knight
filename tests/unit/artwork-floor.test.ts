import { rectangle } from '../fixtures/ground';
import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import { boundaryContains, clampToBoundary, supportedPosition } from '../../src/content/collision';
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

// Geometry regressions own their paintings; editor saves remain disposable.
import { tuning } from '../../src/content/gameplay';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { ContentRegistry } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';

test('camera covers the floor and frames reachable hero silhouettes across edges, aspect and zoom', () => {
  for (const [width, depth, layout] of [
    [6, 4, undefined],
    [6, 4, 'artwork'],
    [24, 24, 'artwork'],
    [30, 18, 'artwork'],
    [18, 30, 'artwork'],
  ] as const) {
    const document = emptyScene();
    Object.assign(document.floor, { layout, width, depth });
    const { area } = resolveScene(document),
      frameHero = width > 6,
      height = cameraContract.heroHeight * tuning.heroVisualScale;
    for (const aspect of [9 / 16, 16 / 9, frameHero ? 21 / 9 : 3, 6])
      for (const span of frameHero ? [8.55, 15] : [2, 4, 9, 30])
        for (const p of [{ x: 0, z: 0 }, ...artworkFloorLayout(width, depth).corners]) {
          const hero = supportedPosition(area, p, 0.3),
            position = new Vector3(hero.x, 0, hero.z),
            target = position.clone().add(new Vector3(0, 1.7, 0)),
            camera = makeCamera(aspect);
          resizeCamera(camera, aspect * 900, 900, span);
          constrainCamera(camera, target, area, frameHero ? { position, height } : undefined);
          camera.position.copy(target).addScaledVector(outward, 30);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          if (frameHero) {
            const foot = position.clone().project(camera),
              head = position
                .clone()
                .add(new Vector3(0, height, 0))
                .project(camera);
            for (const screen of [foot, head])
              assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1, 'hero outside viewport');
            assert.ok(head.y <= 0.76 + 1e-7, 'head behind controls');
          }
          for (const x of [0, aspect * 900])
            for (const y of [0, 900]) {
              const corner = groundPoint(camera, x, y, {
                left: 0,
                top: 0,
                width: aspect * 900,
                height: 900,
              })!;
              corner.addScaledVector(outward, -0.01 / outward.y);
              assert.ok(corner.x >= area.bounds.minX - 1e-8 && corner.x <= area.bounds.maxX + 1e-8);
              assert.ok(corner.z >= area.bounds.minZ - 1e-8 && corner.z <= area.bounds.maxZ + 1e-8);
              if (area.sceneBoundary) assert.ok(boundaryContains(area.sceneBoundary, corner));
            }
          // Moving away from a small floor releases its temporary zoom constraint.
          resizeCamera(camera, aspect * 900, 900, 0.5);
          constrainCamera(camera, target, area);
          assert.equal(camera.zoom, 1);
        }
  }
});

test('checkpoints at an old scene edge move onto clear framed ground', () => {
  const square = (size: number) => [
    { x: -size, z: -size },
    { x: size, z: -size },
    { x: size, z: size },
    { x: -size, z: size },
  ];
  const content = new ContentRegistry({
    ...contentDefinitions,
    areas: [
      {
        ...contentDefinitions.areas[0]!,
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
        entries: [{ id: 'start', x: 0, z: 0 }],
        sceneBoundary: square(10),
        playableBoundary: square(8),
        exits: [],
        props: [],
        spawns: [
          { id: 'fallen', actor: 'skeleton', x: 1, z: 0, rewards: [{ item: 'gold', amount: 1 }] },
        ],
      },
    ],
  });
  const session = new GameSession(content),
    save = session.captureSave();
  Object.assign(save.player, { x: 9, z: 0 });
  const area = content.area(save.area),
    spawn = area.spawns[0]!,
    state = save.areas[save.area]!;
  Object.assign(state.actors[spawn.id]!, { x: save.player.x, z: save.player.z, health: 0 });
  state.cleared = true;
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
