import { readAsset } from '../../tools/assets/io';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { resolveAuthoredScene, sceneAssets } from '../../src/content/world-art';
import { sceneFixture } from '../fixtures/scene';
const scene = sceneFixture('graveyard');
scene.objects.push(
  ...[6, 2].map((z, i) => ({
    id: `fixture-panel-${i}`,
    kind: 'decal' as const,
    asset: 'ink-stage-road',
    clip: 'panel',
    x: 0,
    z,
    zone: 'route',
  })),
);
const graveyardArt = resolveAuthoredScene(scene);
// The graveyard renderer adds falling leaves even in this reduced contract fixture.
graveyardArt.proceduralAssets = [...graveyardArt.proceduralAssets, 'ink-ambient'];
import { sceneArtFindings } from '../../src/content/scene-art-validation';
import { isSupportedPosition, supportedPosition } from '../../src/content/world';
import { content } from '../fixtures/content';
import { assetCatalog } from '../../src/content/visuals';
import { parseManifest } from '../../src/assets/schema';
import { InkRoom } from '../../src/presentation/ink-room';
import { makeCamera } from '../../src/core/camera';
import { Simulation } from '../../src/core/simulation';
import { cardCoverage, coverageAt } from '../../src/presentation/scenery-reveal';
import { pageIdentity } from '../../src/assets/loader';
import { coplanarArtConflicts } from '../../src/presentation/carrier-validation';
import { ActorSprite } from '../../src/presentation/sprite';
import type { PackLease } from '../../src/assets/loader';
import { readRegistration } from '../../tools/assets/data';
const coverage = readRegistration().coverage;
const manifests = new Map(
  sceneAssets(graveyardArt).map((id) => [
    id,
    readAsset('public/' + assetCatalog[id]!, 'utf8').then((bytes) =>
      parseManifest(JSON.parse(bytes)),
    ),
  ]),
);
async function fixture() {
  const packs = new Map<string, PackLease>();
  for (const id of sceneAssets(graveyardArt)) {
    const manifest = await manifests.get(id)!;
    packs.set(id, {
      manifest,
      textures: new Map(manifest.pages.map((p) => [p.id, new T.Texture()])),
    } as PackLease);
  }
  const room = new InkRoom(
    content.area('court'),
    packs,
    new T.Group(),
    makeCamera(16 / 9),
    undefined,
    readRegistration(),
    graveyardArt,
  );
  room.build();
  return {
    room,
    packs,
    dispose() {
      room.dispose();
      for (const p of packs.values()) for (const t of p.textures.values()) t.dispose();
    },
  };
}

test('art validation rejects solid penetration and an allowance reused away from its registered join', () => {
  assert.deepEqual(sceneArtFindings(graveyardArt), []);
  const moved = {
    ...graveyardArt,
    props: [...graveyardArt.props, { ...graveyardArt.props[0]!, id: 'gate-lamp', x: -6.1, z: 1.4 }],
  };
  assert.ok(
    sceneArtFindings(moved).some(
      (f) => f.kind === 'solid-intersection' && [f.a, f.b].includes('family-tomb-west'),
    ),
  );
  const invalid = {
    ...graveyardArt,
    overlaps: [
      {
        a: 'gate-lamp',
        b: 'family-tomb-west',
        region: { minX: -3.7, maxX: -3.05, minZ: 7.9, maxZ: 8.5 },
        reason: 'Registered original join',
      },
    ],
    props: moved.props,
  };
  assert.ok(sceneArtFindings(invalid).some((f) => f.kind === 'solid-intersection'));
});
test('oriented footprint collision follows the visible long axis rather than its axis-aligned bounding box', () => {
  const base = content.area('court'),
    area = {
      ...base,
      props: [
        {
          id: 'angled-tomb',
          kind: 'wall' as const,
          x: 0,
          z: 0,
          radius: 0.2,
          height: 1,
          size: [2, 0.4] as const,
          shape: 'box' as const,
          rotation: Math.PI / 4,
        },
      ],
    };
  assert.ok(!isSupportedPosition(area, { x: 0.55, z: 0.55 }, 0.3));
  assert.ok(isSupportedPosition(area, { x: 0.8, z: -0.8 }, 0.3));
  const q = supportedPosition(area, { x: 0, z: 0 }, 0.3);
  assert.ok(isSupportedPosition(area, q, 0.3));
  assert.ok(Math.abs(q.x + q.z) < 1e-8);
});
test('four-centimetre reversals behind a near tree retains one shader/depth policy and a continuous local reveal', async () => {
  const f = await fixture(),
    sim = new Simulation(content, 142, content.definitions.initialArea, 1);
  sim.enemies.forEach((a) => (a.health = 0));
  try {
    assert.ok(graveyardArt.props.every((p) => f.room.sprites.some((s) => s.id === p.id)));
    const tree = graveyardArt.props.find((p) => p.id === 'boundary-oak')!;
    Object.assign(sim.hero, { x: tree.x, z: tree.z - 0.2, px: tree.x, pz: tree.z - 0.2 });
    for (let i = 0; i < 30; i++) f.room.update(sim, 1, false, 1000 / 60);
    const wall = f.room.sprites.filter((s) => s.id === 'boundary-oak'),
      versions = wall.map((s) => s.material.version);
    const before = f.room.graveyard!.revealStats();
    for (const z of [tree.z - 0.16, tree.z - 0.2, tree.z - 0.16, tree.z - 0.2]) {
      Object.assign(sim.hero, { z, pz: z });
      f.room.update(sim, 1, false, 1000 / 60);
      assert.ok(
        wall.every(
          (s) => s.material.opacity === 1 && s.material.transparent && s.material.depthWrite,
        ),
      );
      assert.deepEqual(
        wall.map((s) => s.material.version),
        versions,
      );
    }
    const after = f.room.graveyard!.revealStats();
    assert.ok(after.some((s) => s.strength > 0.5));
    assert.ok(
      after.every((s, i) => Math.abs(s.strength - before[i]!.strength) < 0.3),
      'tiny reversals must not jump a whole module between solid and invisible',
    );
    const paused = after.map((s) => s.strength);
    f.room.update(sim, 1, false, 0);
    assert.deepEqual(
      f.room.graveyard!.revealStats().map((s) => s.strength),
      paused,
    );
  } finally {
    f.dispose();
  }
});
test('alpha-aware validation distinguishes a real duplicated card from empty carrier overlap', async () => {
  assert.equal(coverageAt({ width: 2, height: 1, alpha: [255, 0] }, 0.75, 0.5), 0);
  const f = await fixture();
  try {
    const stone = f.room.sprites.find((s) => s.id === 'grave-family-kept')!,
      copy = new ActorSprite(
        'accidental-copy',
        stone.manifest,
        stone.textures,
        stone.animator.clip,
      );
    copy.show(copy.animator.frame, stone.mesh.position.clone(), makeCamera(16 / 9));
    copy.mesh.scale.copy(stone.mesh.scale);
    assert.ok(coplanarArtConflicts([stone, copy], coverage.masks).length === 1);
    const p = new T.Vector3(100, 100, 100);
    assert.equal(cardCoverage(stone, p), 0);
    copy.dispose();
  } finally {
    f.dispose();
  }
});
test('ground panel butt joins have zero overlap area while real shared source coverage fails', async () => {
  const f = await fixture();
  try {
    const panels = f.room.sprites.filter((s) => s.id.startsWith('fixture-panel')).slice(0, 2);
    assert.equal(panels.length, 2);
    assert.deepEqual(coplanarArtConflicts(panels, coverage.masks), []);
    panels[1]!.mesh.position.z += 0.25;
    assert.equal(coplanarArtConflicts(panels, coverage.masks).length, 1);
  } finally {
    f.dispose();
  }
});
test('terrain mips never share identity with a non-mipmapped lease or bleed across atlas frames', async () => {
  const m = parseManifest(
    JSON.parse(await readAsset('public/' + assetCatalog['ink-graveyard-materials']!, 'utf8')),
  );
  assert.ok(m.pages.every((p) => p.mipmaps));
  assert.notEqual(pageIdentity(m.pages[0]!), pageIdentity({ ...m.pages[0]!, mipmaps: false }));
  const bad = structuredClone(m);
  bad.frames[0]!.rect[0] = 1;
  assert.throws(() => parseManifest(bad));
});

test('blocked terrain volumes reject buried roots and bodies exactly on a polygon edge', () => {
  const area = {
    ...content.area('court'),
    props: [
      {
        id: 'terrain',
        kind: 'border' as const,
        x: 0,
        z: 0,
        radius: 0.2,
        height: 0.7,
        shape: 'polygon' as const,
        polygon: [
          { x: 0, z: 0 },
          { x: 2, z: 0 },
          { x: 2, z: 2 },
          { x: 0, z: 2 },
        ],
      },
    ],
  };
  for (const p of [
    { x: 1, z: 1 },
    { x: 2, z: 1 },
  ]) {
    assert.equal(isSupportedPosition(area, p, 0.3), false);
    const q = supportedPosition(area, p, 0.3);
    assert.equal(isSupportedPosition(area, q, 0.3), true);
    assert.ok(q.x >= 2.3 || q.x <= -0.3 || q.z >= 2.3 || q.z <= -0.3);
  }
});
