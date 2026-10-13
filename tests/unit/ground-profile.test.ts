import { temporaryDirectory } from '../fixtures/temporary-directory';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GroundProfileStore } from '../../tools/scene/ground-profile-store';
import { SceneStore } from '../../tools/scene/scene-editor-store';
import { emptyScene } from '../../src/editor/default-scene';
import { restoreGroundProfile } from '../../src/content/ground-profile';

it('retains independent interaction revisions after scene deletion, clearing and artwork replacement', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-profiles-');

  const profiles = new GroundProfileStore(path.join(root, 'profiles')),
    scenes = new SceneStore(path.join(root, 'scenes'), undefined, profiles),
    d = emptyScene();
  d.floor.layout = 'artwork';
  d.groundInteraction = {
    asset: d.floor.asset,
    frame: 'frame',
    hash: 'a'.repeat(64),
    dimensions: [4096, 4096],
    regions: [
      {
        id: 'tree',
        name: 'Tree',
        footprint: [
          { x: 1, z: 1 },
          { x: 2, z: 1 },
          { x: 2, z: 2 },
        ],
        mask: [
          {
            outer: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
            holes: [
              [
                [0.2, 0.2],
                [0.3, 0.2],
                [0.3, 0.3],
              ],
            ],
          },
        ],
        depth: { kind: 'anchor', point: { x: 2, z: 2 } },
      },
    ],
    destinations: [{ name: 'Gap', x: 3, z: 3 }],
  };
  const saved = await scenes.save(d, null),
    first = (await profiles.list())[0]!;
  const original = await profiles.read(first.id);
  d.groundInteraction.regions[0]!.name = 'Reviewed tree';
  const second = await scenes.save(d, saved.revision);
  delete d.groundInteraction;
  await scenes.save(d, second.revision);
  await fs.rm(path.join(root, 'scenes/untitled.json'));
  assert.equal((await profiles.list()).length, 2);
  assert.deepEqual(await profiles.read(first.id), original);
  const identity = { ...original.interaction, asset: 'reorganized-artwork', frame: 'new-frame' };
  const restored = restoreGroundProfile(original, identity, { width: 40, depth: 40 }, false);
  assert.equal(restored.asset, 'reorganized-artwork');
  assert.ok(Math.abs(restored.regions[0]!.footprint![0]!.x - 2) < 1e-10);
  assert.ok(Math.abs(restored.regions[0]!.footprint![0]!.z - 2) < 1e-10);
  assert.deepEqual(restored.regions[0]!.mask, original.interaction.regions[0]!.mask);
  assert.throws(
    () =>
      restoreGroundProfile(original, { ...identity, hash: 'b'.repeat(64) }, original.floor, false),
    /Artwork changed/,
  );
  const reviewed = restoreGroundProfile(
    original,
    { ...identity, hash: 'b'.repeat(64) },
    original.floor,
    true,
  );
  assert.equal(reviewed.hash, 'b'.repeat(64));
  assert.deepEqual(await profiles.read(first.id), original);
  assert.equal(await profiles.save(original), first.id);
  await fs.writeFile(path.join(root, 'profiles', first.id + '.json'), '{}');
  await assert.rejects(profiles.read(first.id), /damaged/);
  await assert.rejects(profiles.save(original), /damaged/);
  const revisions = await profiles.list();
  assert.ok(revisions.find((profile) => profile.id === first.id)?.error);
  assert.ok(revisions.some((profile) => profile.id !== first.id && !profile.error));
  assert.equal(await fs.readFile(path.join(root, 'profiles', first.id + '.json'), 'utf8'), '{}');
});
