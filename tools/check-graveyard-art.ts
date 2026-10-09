import { readRegistration } from './assets/data';
import { readAsset } from './assets/io';
import assert from 'node:assert/strict';
import * as T from 'three';
import { worldVisuals } from '../src/content/world-art';
import { graveHead } from '../src/content/graveyard-scene';
const graveyardArt = worldVisuals.court!;
import { coplanarMeshConflicts } from '../src/presentation/mesh-plane-validation';
import { coplanarArtConflicts } from '../src/presentation/carrier-validation';
const coverage = readRegistration().coverage;
import { sceneArtFindings } from '../src/content/scene-art-validation';
import { isSupportedPosition } from '../src/content/world';
import { content } from '../src/content/game-content';
import { areaArtAssets } from '../src/content/world-art';
import { assetCatalog } from '../src/content/visuals';
import { parseManifest } from '../src/assets/schema';
import { InkRoom } from '../src/presentation/ink-room';
import { makeCamera } from '../src/core/camera';
import type { PackLease } from '../src/assets/loader';
const findings = sceneArtFindings(graveyardArt);
assert.deepEqual(findings, [], 'unresolved Graveyard art construction');
const area = content.area('court'),
  packs = new Map<string, PackLease>();
for (const id of areaArtAssets(area)) {
  const manifest = parseManifest(
    JSON.parse(await readAsset('public/' + assetCatalog[id]!, 'utf8')),
  );
  packs.set(id, {
    manifest,
    textures: new Map(manifest.pages.map((p) => [p.id, new T.Texture()])),
  } as PackLease);
}
const room = new InkRoom(
  area,
  packs,
  new T.Group(),
  makeCamera(16 / 9),
  undefined,
  readRegistration(),
);
room.build();
try {
  assert.deepEqual(
    coplanarArtConflicts(room.sprites, coverage.masks),
    [],
    'undeclared opaque art occupies the same depth plane',
  );
  const architecture = room.graveyard!.architecture;
  assert.deepEqual(
    coplanarMeshConflicts(architecture.parts),
    [],
    'opaque construction planes share depth',
  );
  assert.equal(architecture.parts.length, 0, 'No manufactured visible geometry');
  assert.ok(
    room.sprites.some((s) => s.id === 'chapel-shell'),
    'Complete illustrated building shell',
  );
  for (const wall of graveyardArt.walls)
    assert.ok(
      area.props.some(
        (p) =>
          p.id === wall.id &&
          p.rotation === Math.atan2(wall.to.z - wall.from.z, wall.to.x - wall.from.x),
      ),
      'masonry collision follows its authored edge',
    );
  for (const g of graveyardArt.graves) {
    const marker = graveyardArt.props.find((p) => p.id === `grave-${g.id}`)!,
      head = graveHead(g);
    assert.equal(marker.x, head.x);
    assert.equal(marker.z, head.z);
  }
  for (const x of [-0.9, 0, 0.9])
    for (let z = -4.7; z <= 4.3; z += 0.2)
      assert.ok(isSupportedPosition(area, { x, z }, 0.3), `central corridor blocked at ${x}/${z}`);
  for (const entry of area.entries) assert.ok(isSupportedPosition(area, entry, 0.3));
  const floor = packs.get(graveyardArt.floor)!;
  assert.equal(floor.manifest.frames.length, 1);
  assert.ok(floor.manifest.pages.every((p) => p.mipmaps));
  console.log(
    `PASS: Graveyard footprints, intact chapel shell and flat ground, clear corridor, standalone terrain mipmaps and fixture sockets`,
  );
} finally {
  room.dispose();
  for (const p of packs.values()) for (const t of p.textures.values()) t.dispose();
}
