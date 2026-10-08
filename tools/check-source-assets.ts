import assert from 'node:assert/strict';
import { hash, exactSource } from './compiler';
import { readAsset } from './assets/io';
import { readLibrarySource } from './assets/sources';
import { parseManifest } from '../src/assets/schema';
import sharp from 'sharp';
const current = parseManifest(
    JSON.parse(await readAsset('public/generated/ink/ink-hero-current/manifest.json', 'utf8')),
  ),
  receipt = JSON.parse(await readAsset('staging/ink/hero-receipt.json', 'utf8'));
for (const record of receipt.frames) {
  const frame = current.frames.find((f) => f.id === record.id)!;
  assert.deepEqual(frame.registration, record.registration);
  const source = await readLibrarySource(record.member, record.group);
  assert.equal(hash(source), record.sha256);
  assert.deepEqual(await exactSource(frame.source), source);
}
assert.deepEqual(
  await exactSource('ink/ink-skeleton/rest.png'),
  await readLibrarySource('packs/02_enemies/assets/02_skeleton_halberdier.png'),
);
for (const id of [
  'ink-hero-current',
  'ink-skeleton',
  'ink-scenery',
  'ink-crypt',
  'ink-chapel-altar',
  'ink-chapel-window',
  'ink-chapel-pew',
  'ink-chapel-broken-pew',
  'ink-chapel-collapse',
  'ink-chapel-floor',
  'ink-tended-marker',
  'ink-tended-fragments',
  'ink-tended-roots',
  'ink-tended-understory',
  'ink-tended-woodland-near',
  'ink-tended-woodland-far',
]) {
  const manifest = parseManifest(
      JSON.parse(await readAsset(`public/generated/ink/${id}/manifest.json`, 'utf8')),
    ),
    pages = new Map<string, { data: Buffer; info: { width: number; height: number } }>();
  for (const frame of manifest.frames) {
    const source = await sharp(await exactSource(frame.source))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      page = manifest.pages.find((p) => p.id === frame.page)!,
      atlas =
        pages.get(page.id) ??
        (await sharp(await readAsset(`public/generated/ink/${id}/${page.path}`))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }));
    pages.set(page.id, atlas);
    for (let y = 0; y < frame.trim[3]; y++)
      for (let x = 0; x < frame.trim[2]; x++) {
        const a = ((frame.trim[1] + y) * source.info.width + frame.trim[0] + x) * 4,
          b = ((frame.rect[1] + y) * atlas.info.width + frame.rect[0] + x) * 4;
        assert.equal(atlas.data[b + 3], source.data[a + 3]);
        if (source.data[a + 3])
          assert.deepEqual(atlas.data.subarray(b, b + 3), source.data.subarray(a, a + 3));
      }
  }
}
const flow = JSON.parse(await readAsset('staging/animation/flow.json', 'utf8'));
assert.equal(hash(await readAsset('staging/animation/flow.png')), flow.sha256);
for (const [file, expected] of Object.entries(flow.preparedHashes))
  assert.equal(hash(await exactSource(file)), expected);
console.log(
  'PASS: current original bytes, native registrations, atlas pixels and transition bindings verified.',
);
