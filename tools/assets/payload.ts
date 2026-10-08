import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assetCatalog } from '../../src/content/asset-catalog';
import { playgroundCatalog } from '../../src/content/effects-playground-assets';
import { parseManifest } from '../../src/assets/schema';
import { parseRegistration } from '../../src/assets/registration';
import { readAuthoringCatalog } from './authoring-catalog';
import { safeRelative } from './paths';

export async function stagePayload(sourcePublic: string, staging: string, destination: string) {
  const files = new Set([
    'build-mode.json',
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
    const m = parseManifest(JSON.parse(await fs.readFile(path.join(sourcePublic, file), 'utf8')));
    for (const page of m.pages) files.add(path.posix.join(path.posix.dirname(file), page.path));
  }
  for (const folder of ['lighting', 'visual-effects']) {
    const data = JSON.parse(
      await fs.readFile(
        path.join(
          sourcePublic,
          folder,
          'manifest.json'.replace(
            'manifest',
            folder === 'visual-effects' ? 'surfaces' : 'manifest',
          ),
        ),
        'utf8',
      ),
    );
    for (const entry of Object.values(data.entries) as { file: string }[])
      files.add(folder + '/' + safeRelative(entry.file));
  }
  await fs.mkdir(path.join(destination, 'metadata'), { recursive: true });
  for (const file of [...files].sort()) {
    safeRelative(file);
    const target = path.join(destination, 'public', file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Both locations belong to the same leased candidate; immutable pages need
    // no second physical copy while source fidelity and freshness are checked.
    await fs.link(path.join(sourcePublic, file), target);
  }
  const animation = JSON.parse(
      await fs.readFile(path.join(staging, 'animation/flow.json'), 'utf8'),
    ),
    coverage = JSON.parse(
      await fs.readFile(path.join(staging, 'ink/graveyard-coverage.json'), 'utf8'),
    );
  const registration = JSON.stringify(parseRegistration({ schemaVersion: 2, animation, coverage }));
  await fs.writeFile(path.join(destination, 'public/registration.json'), registration);
  const flags = JSON.parse(
    await fs.readFile(path.join(destination, 'public/build-mode.json'), 'utf8'),
  );
  flags.registrationHash = createHash('sha256').update(registration).digest('hex');
  await fs.writeFile(path.join(destination, 'public/build-mode.json'), JSON.stringify(flags));
  await fs.mkdir(path.join(destination, 'public/animation'), { recursive: true });
  await fs.copyFile(
    path.join(staging, 'animation/flow.png'),
    path.join(destination, 'public/animation/flow.png'),
  );
  for (const name of [
    'ink/derivatives.json',
    'ink/hero-receipt.json',
    'ink/graveyard-art-receipt.json',
    'ink/tended-art-receipt.json',
    'ink/graveyard-ground-receipt.json',
    'rest/receipt.json',
    'effects-playground/receipt.json',
    'visual-effects/receipt.json',
    'library/receipt.json',
  ]) {
    const target = path.join(destination, 'metadata', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(staging, name), target);
  }
  return files.size;
}
