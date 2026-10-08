import assert from 'node:assert/strict';
import type { Manifest } from '../src/assets/schema';
export function needsLighting(id: string, manifest: Manifest) {
  return (
    [
      'ink-hero-current',
      'ink-skeleton',
      'ink-scenery',
      'ink-graveyard-scenery',
      'ink-blackwood-oak',
      'ink-blackwood-woodland',
    ].includes(id) ||
    id.startsWith('ink-tended-') ||
    (id.startsWith('library-') &&
      ['prop', 'character'].includes(manifest.asset.type) &&
      manifest.asset.placement === 'upright')
  );
}
export type LightingBinding = {
  sourceHash: string;
  rect: number[];
  trim: number[];
  file: string;
  hash: string;
};
export function validateLightingBindings(
  library: { recipe: string; entries: Record<string, LightingBinding> },
  manifests: ReadonlyMap<string, Manifest>,
) {
  assert.equal(library.recipe, 'alpha-volume-v1');
  const expected = new Map<string, { manifest: Manifest; frame: Manifest['frames'][number] }>();
  for (const [id, manifest] of manifests) {
    if (!needsLighting(id, manifest)) continue;
    for (const frame of manifest.frames) expected.set(`${id}:${frame.id}`, { manifest, frame });
  }
  for (const [key, { manifest, frame }] of expected) {
    const entry = library.entries[key];
    assert.ok(entry, `Missing lighting companion ${key}`);
    assert.equal(
      entry.sourceHash,
      manifest.pages.find((page) => page.id === frame.page)!.hash,
      `Stale lighting companion ${key}`,
    );
    assert.deepEqual(entry.rect, frame.rect, `Lighting crop differs ${key}`);
    assert.deepEqual(entry.trim, frame.trim, `Lighting registration differs ${key}`);
  }
  for (const key of Object.keys(library.entries))
    assert.ok(expected.has(key), `Unknown lighting companion ${key}`);
}
