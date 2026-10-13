import { readJson, writeJson } from '../json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative, listFiles } from './files';

import { playgroundCatalog } from '../../src/content/effects-playground-assets';
import { parseManifest } from '../../src/assets/schema';
import { parseRegistration } from '../../src/assets/registration';
import { readAuthoringCatalog } from './authoring-catalog';

import { loadingVideoPath } from '../../src/content/loading-media';

export async function stagePayload(
  sourcePublic: string,
  staging: string,
  destination: string,
  inPlace = false,
) {
  if (inPlace && path.resolve(sourcePublic) !== path.resolve(destination, 'public'))
    throw new Error('In-place finalization requires the same public directory');
  const files = new Set([
    'build-mode.json',
    loadingVideoPath,
    'generated/calibration.json',
    'lighting/manifest.json',
    'visual-effects/surfaces.json',
    'dev-effects/emitters.json',
    'generated/library/catalog.json',
  ]);
  for (const file of Object.values({
    ...(await readAuthoringCatalog(sourcePublic)),
    ...playgroundCatalog,
  })) {
    files.add(file);
    const m = parseManifest(await readJson(path.join(sourcePublic, file)));
    for (const page of m.pages) {
      files.add(path.posix.join(path.posix.dirname(file), page.path));
      for (const image of [...(page.delivery ?? []), ...(page.preview ? [page.preview] : [])])
        files.add(image.path);
      if (page.delivery?.length)
        files.add(path.posix.dirname(page.delivery[0]!.path) + '/receipt.json');
    }
  }
  for (const file of [
    'generated/library/index.json',
    'generated/library/inventory.json',
    'generated/library/delivery-report.json',
    'decoders/basis_transcoder.js',
    'decoders/basis_transcoder.wasm',
  ])
    if (
      await fs.access(path.join(sourcePublic, file)).then(
        () => true,
        () => false,
      )
    )
      files.add(file);
  try {
    const inventory = await readJson(path.join(sourcePublic, 'generated/library/inventory.json'));
    for (const media of inventory.media ?? []) files.add(safeRelative(media.file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const folder of ['lighting', 'visual-effects']) {
    const data = await readJson(
      path.join(
        sourcePublic,
        folder,
        'manifest.json'.replace('manifest', folder === 'visual-effects' ? 'surfaces' : 'manifest'),
      ),
    );
    for (const entry of Object.values(data.entries) as { file: string }[])
      files.add(folder + '/' + safeRelative(entry.file));
  }
  await fs.mkdir(path.join(destination, 'metadata'), { recursive: true });
  if (!inPlace)
    for (const file of [...files].sort()) {
      safeRelative(file);
      const target = path.join(destination, 'public', file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Both locations belong to the same leased candidate; immutable pages need
      // no second physical copy while source fidelity and freshness are checked.
      await fs.link(path.join(sourcePublic, file), target);
    }
  const atomic = async (file: string, bytes: Buffer | string) => {
    await fs.writeFile(file + '.finalize-tmp', bytes);
    await fs.rename(file + '.finalize-tmp', file);
  };
  const animation = await readJson(path.join(staging, 'animation/flow.json')),
    coverage = await readJson(path.join(staging, 'ink/graveyard-coverage.json'));
  const registration = JSON.stringify(parseRegistration({ schemaVersion: 2, animation, coverage }));
  await atomic(path.join(destination, 'public/registration.json'), registration);
  files.add('registration.json');
  const flags = await readJson(path.join(destination, 'public/build-mode.json'));
  flags.registrationHash = createHash('sha256').update(registration).digest('hex');
  const flagsFile = path.join(destination, 'public/build-mode.json');
  await writeJson(flagsFile + '.tmp', flags);
  await fs.rename(flagsFile + '.tmp', flagsFile);
  await fs.mkdir(path.join(destination, 'public/animation'), { recursive: true });
  await atomic(
    path.join(destination, 'public/animation/flow.png'),
    await fs.readFile(path.join(staging, 'animation/flow.png')),
  );
  files.add('animation/flow.png');
  for (const name of [
    'ink/derivatives.json',
    'ink/flat-stage-receipt.json',
    'ink/hero-receipt.json',
    'ink/graveyard-art-receipt.json',
    'ink/tended-art-receipt.json',
    'ink/graveyard-ground-receipt.json',
    'ink/coverage-inputs.json',
    'rest/receipt.json',
    'effects-playground/receipt.json',
    'visual-effects/receipt.json',
    'library/receipt.json',
  ]) {
    const target = path.join(destination, 'metadata', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomic(target, await fs.readFile(path.join(staging, name)));
  }
  if (inPlace)
    for (const name of await listFiles(sourcePublic))
      if (!files.has(name)) await fs.rm(path.join(sourcePublic, name));
  return files.size;
}
