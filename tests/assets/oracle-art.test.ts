import test from 'node:test';
import assert from 'node:assert/strict';
import { readAsset } from '../../tools/assets/io';
import { parseManifest, resolveActorClip } from '../../src/assets/schema';
import { actorVisuals } from '../../src/content/visuals';
import { combatFeedback } from '../../src/content/combat-feedback';

test('supplied Oracle headings retain cast release and the rib lane retains its contact marker', async () => {
  const binding = actorVisuals['candlebone-oracle']!;
  const oracle = parseManifest(
    JSON.parse(await readAsset(`public/generated/library/${binding.asset}/manifest.json`, 'utf8')),
  );
  assert.notEqual(oracle.asset.mirroring, true);
  for (const heading of ['d00', 'd90', 'd180', 'd270'] as const) {
    for (const clip of Object.values(binding.clips))
      assert.ok(resolveActorClip(oracle, clip, heading).frames.length);
    const cast = oracle.asset.clips.attack![heading]!;
    const contact =
      cast.markers?.find((m) => m.id === 'visual_orb_cast')?.atMs ??
      cast.durationsMs.slice(0, binding.attackContactDrawing! - 1).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(contact - (38 * 1000) / 60) < 0.001);
  }
  const lane = parseManifest(
    JSON.parse(
      await readAsset(
        `public/generated/library/${combatFeedback.ribLane.asset}/manifest.json`,
        'utf8',
      ),
    ),
  );
  assert.deepEqual(lane.asset.canvas, [512, 384]);
  assert.equal(lane.asset.projection, 'projected-world');
  const clip = lane.asset.clips.show!.d45!;
  assert.equal(clip.frames.length, 24);
  assert.equal(clip.markers?.find((m) => m.id === 'contact')?.atMs, 1020);
  assert.equal(clip.loop, false);
});
