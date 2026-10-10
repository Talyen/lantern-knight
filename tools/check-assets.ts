import { validateLightingBindings, type LightingBinding } from './lighting-bindings';
import assert from 'node:assert/strict';
import path from 'node:path';
import { actorVisuals } from '../src/content/visuals';
import { parseManifest, resolveClip, type Manifest } from '../src/assets/schema';
import {
  HEADINGS,
  cameraCalibration as calibrationFixture,
} from '../src/assets/camera-calibration';
import fs from 'node:fs/promises';
import { parseRegistration } from '../src/assets/registration';
import { projectRoot } from './assets/paths';
import { openWorkspace, type AssetWorkspace } from './assets/workspace';
import { fileURLToPath } from 'node:url';
import { safeRelative } from './assets/files';
import { hash } from './compiler';
import { loadingVideoPath } from '../src/content/loading-media';
import { validateLoadingVideo } from './assets/loading-media';
import { readGameCatalog } from './game-asset-catalog';
export async function checkAssets(workspace: Pick<AssetWorkspace, 'publicDirectory'>) {
  const readPublic = (file: string) =>
    fs.readFile(path.join(workspace.publicDirectory, safeRelative(file)));
  validateLoadingVideo(await readPublic(loadingVideoPath));
  const manifests = new Map<string, Manifest>();
  const catalog: Readonly<Record<string, string>> = {
    ...(await readGameCatalog(workspace.publicDirectory)),
  };
  let pages = 0;
  assert.deepEqual(
    JSON.parse((await readPublic('generated/calibration.json')).toString()),
    JSON.parse(JSON.stringify(calibrationFixture())),
    'Prepared camera differs',
  );
  for (const [id, file] of Object.entries(catalog)) {
    const manifest = parseManifest(JSON.parse((await readPublic(file)).toString()));
    assert.equal(manifest.asset.id, id);
    manifests.set(id, manifest);
    for (const page of manifest.pages) {
      assert.equal(
        hash(await readPublic(path.posix.join(path.posix.dirname(file), page.path))),
        page.hash,
        `Prepared page differs: ${id}/${page.id}`,
      );
      pages++;
    }
    for (const visual of Object.values(actorVisuals).filter((v) => v.asset === id))
      for (const clip of [...Object.values(visual.clips), ...visual.attacks])
        for (const heading of HEADINGS) resolveClip(manifest, clip, heading);
  }
  const registration = parseRegistration(
    JSON.parse((await readPublic('registration.json')).toString()),
  );
  assert.equal(hash(await readPublic('animation/flow.png')), registration.animation.sha256);
  assert.equal(
    registration.animation.tuningHash,
    hash(await fs.readFile(path.join(projectRoot, 'authoring/hero-actions.json'))),
  );
  assert.equal(
    registration.animation.motionHash,
    hash(await fs.readFile(path.join(projectRoot, 'authoring/hero-motion.json'))),
  );
  const lighting = JSON.parse((await readPublic('lighting/manifest.json')).toString());
  lighting.entries = Object.fromEntries(
    Object.entries(lighting.entries).filter(([key]) => manifests.has(key.split(':')[0]!)),
  );
  validateLightingBindings(lighting, manifests);
  const companionHashes = new Map<string, string>();
  for (const entry of Object.values(lighting.entries) as LightingBinding[]) {
    if (!companionHashes.has(entry.file))
      companionHashes.set(entry.file, hash(await readPublic('lighting/' + entry.file)));
    assert.equal(companionHashes.get(entry.file), entry.hash);
  }
  await (await import('./check-scene-documents')).checkSceneDocuments(process.cwd(), manifests);
  // Native-pixel diagnostics remain explicit investigations.
  console.log(
    `PASS: ${Object.keys(catalog).length} runtime assets / ${pages} pages; current references and registration verified.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspace = await openWorkspace();
  try {
    await checkAssets(workspace);
  } finally {
    await workspace.release();
  }
}
