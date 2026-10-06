import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assetCatalog, actorVisuals} from '../src/content/visuals';
import {parseManifest} from '../src/assets/schema';
import {HEADINGS} from '../src/core/camera';
import {compile, hash, exactSource} from './compiler';
import {calibrationFixture} from '../src/core/camera';
const expected = await compile('source.json', undefined, false, true),
  published = JSON.parse(
    await fs.readFile('public/generated/manifest.json', 'utf8'),
  );
assert.deepEqual(
  published,
  expected,
  'generated manifest is stale; run npm run assets:compile',
);
for (const page of expected.pages)
  assert.equal(
    hash(await fs.readFile(path.join('public/generated', page.path))),
    page.hash,
    `published page differs: ${page.path}`,
  );
assert.deepEqual(
  JSON.parse(await fs.readFile('public/generated/calibration.json', 'utf8')),
  JSON.parse(JSON.stringify(calibrationFixture())),
  'camera fixture is stale',
);
for (const [id, file] of Object.entries(assetCatalog)) {
  const manifest = parseManifest(
    JSON.parse((await exactSource(file, 'public')).toString()),
  );
  if (file !== 'generated/manifest.json')
    for (const page of manifest.pages)
      assert.equal(
        hash(
          await exactSource(
            path.posix.join(path.posix.dirname(file), page.path),
            'public',
          ),
        ),
        page.hash,
        `catalog page differs: ${id}/${page.path}`,
      );
  for (const visual of Object.values(actorVisuals).filter(
    (v) => v.asset === id,
  )) {
    for (const clip of [...Object.values(visual.clips), ...visual.attacks])
      for (const heading of HEADINGS) {
        const target =
          manifest.asset.clips[clip] ??
          manifest.asset.clips[manifest.asset.fallbacks[clip] ?? ''];
        assert.ok(
          target?.[heading],
          `visual binding missing clip: ${visual.id}/${clip}/${heading}`,
        );
      }
  }
}
console.log(
  `PASS: staged sources, generated pages, calibration and asset bindings match; no files written.`,
);
