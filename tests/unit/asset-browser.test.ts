import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedAsset, assetClosure, matchesAsset } from '../../src/assets/asset-browser';
import type { Manifest } from '../../src/assets/schema';
const clip = (frames: string[]) => ({
  frames,
  durationsMs: frames.map(() => 100),
  loop: true,
  notifies: [],
});
function manifest(id: string, clips: Manifest['asset']['clips'], dependencies: string[] = []) {
  return { asset: { id, clips, dependencies, type: 'character' } } as Manifest;
}
test('animation classification requires distinct drawings in one sequence, not directions or holds', () => {
  assert.equal(
    animatedAsset(manifest('still', { idle: { d00: clip(['front']), d45: clip(['back']) } })),
    false,
  );
  assert.equal(animatedAsset(manifest('held', { idle: { d00: clip(['front', 'front']) } })), false);
  assert.equal(
    animatedAsset(
      manifest('mixed', { idle: { d00: clip(['front']) }, walk: { d45: clip(['a', 'b']) } }),
    ),
    true,
  );
});
test('usage follows references and cyclic dependencies, while filters compose independently', () => {
  const maps = new Map([
    ['hero', manifest('hero', { walk: { d45: clip(['a', 'b']) } }, ['support'])],
    ['support', manifest('support', {}, ['hero'])],
    ['unused-enemy', manifest('unused-enemy', { walk: { d45: clip(['c', 'd']) } })],
  ]);
  const used = assetClosure(['hero'], maps),
    scene = assetClosure(['support'], maps);
  assert.deepEqual([...used], ['hero', 'support']);
  const filter = { scope: 'used' as const, animated: true, type: 'character' as const, search: '' };
  assert.equal(matchesAsset(maps.get('hero')!, filter, used, scene), true);
  assert.equal(matchesAsset(maps.get('unused-enemy')!, filter, used, scene), false);
  assert.equal(
    matchesAsset(
      maps.get('unused-enemy')!,
      { ...filter, scope: 'all', search: 'unused' },
      used,
      scene,
    ),
    true,
  );
  assert.equal(matchesAsset(maps.get('support')!, filter, used, scene), false);
});
