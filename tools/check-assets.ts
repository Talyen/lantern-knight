import { validateLightingBindings, type LightingBinding } from './lighting-bindings';
import assert from 'node:assert/strict';
import path from 'node:path';
import { actorVisuals } from '../src/content/visuals';
import { playgroundCatalog } from '../src/content/effects-playground-assets';
import { parseManifest, resolveClip, type Manifest } from '../src/assets/schema';
import {
  HEADINGS,
  cameraCalibration as calibrationFixture,
} from '../src/assets/camera-calibration';
import { readAsset } from './assets/io';
import { readRegistration } from './assets/data';
import { hash } from './compiler';
import { loadingVideoPath } from '../src/content/loading-media';
import { validateLoadingVideo } from './assets/loading-media';
import { readAuthoringCatalog } from './assets/authoring-catalog';
validateLoadingVideo(await readAsset('public/' + loadingVideoPath));
const manifests = new Map<string, Manifest>();
const catalog: Readonly<Record<string, string>> = {
  ...(await readAuthoringCatalog()),
  ...playgroundCatalog,
};
let pages = 0;
assert.deepEqual(
  JSON.parse(await readAsset('public/generated/calibration.json', 'utf8')),
  JSON.parse(JSON.stringify(calibrationFixture())),
  'Prepared camera differs',
);
for (const [id, file] of Object.entries(catalog)) {
  const manifest = parseManifest(JSON.parse(await readAsset('public/' + file, 'utf8')));
  assert.equal(manifest.asset.id, id);
  manifests.set(id, manifest);
  for (const page of manifest.pages) {
    assert.equal(
      hash(await readAsset('public/' + path.posix.join(path.posix.dirname(file), page.path))),
      page.hash,
      `Prepared page differs: ${id}/${page.id}`,
    );
    pages++;
  }
  for (const visual of Object.values(actorVisuals).filter((v) => v.asset === id))
    for (const clip of [...Object.values(visual.clips), ...visual.attacks])
      for (const heading of HEADINGS) resolveClip(manifest, clip, heading);
}
const registration = readRegistration();
assert.equal(hash(await readAsset('public/animation/flow.png')), registration.animation.sha256);
assert.equal(
  registration.animation.tuningHash,
  hash(await readAsset('authoring/hero-actions.json')),
);
assert.equal(
  registration.animation.motionHash,
  hash(await readAsset('authoring/hero-motion.json')),
);
const lighting = JSON.parse(await readAsset('public/lighting/manifest.json', 'utf8'));
validateLightingBindings(lighting, manifests);
const companionHashes = new Map<string, string>();
for (const entry of Object.values(lighting.entries) as LightingBinding[]) {
  if (!companionHashes.has(entry.file))
    companionHashes.set(entry.file, hash(await readAsset('public/lighting/' + entry.file)));
  assert.equal(companionHashes.get(entry.file), entry.hash);
}
await (await import('./check-scene-documents')).checkSceneDocuments(process.cwd(), manifests);
await import('./check-quality');
const { inspectCrypt } = await import('./check-crypt-art');
const crypt = await inspectCrypt();
assert.deepEqual(crypt.constructionErrors, []);
assert.deepEqual(crypt.depthConflicts, []);
await import('./check-graveyard-art');
console.log(
  `PASS: ${Object.keys(catalog).length} prepared assets / ${pages} pages; bindings, registration, quality and construction verified. Source freshness belongs to assets:prepare.`,
);
