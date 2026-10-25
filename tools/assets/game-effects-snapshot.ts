import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { onAsyncExit } from '../scope-exit';
import { packedCombatEffects, combatEffectCatalog } from '../../src/content/combat-feedback';
import { parseManifest } from '../../src/assets/schema';
import { hash } from '../compiler';
import { AssetCache } from './cache';
import { createPreparationContext } from './context';
import { readLock, payloadDigest } from './pack';
import {
  openRepositoryWorkspace,
  readRepositoryInventory,
  saveRepositoryAssets,
} from './repository';
import { projectRoot, sourceLibraryRoot, sourceLibrary } from './paths';
import { listFiles } from './files';
import { prepare } from './prepare/prepare-game-effects';

// A bounded derivative refresh authenticates its native base and each original
// drawing. It never claims to reprocess unrelated producers with a new recipe.
export async function prepareGameEffectsSnapshot(cache: AssetCache) {
  const pin = await readLock();
  if (pin.schemaVersion !== 5)
    throw new Error('Game effect preparation requires repository-owned native pages');
  const inventory = await readRepositoryInventory(pin);
  const base = await openRepositoryWorkspace(pin, 'authoring', true);
  await using closeBase = onAsyncExit(() => base.release());
  const held = await cache.lease('game-effects-' + randomUUID(), 256 * 1024 ** 2, true);
  await using closeHeld = onAsyncExit(() => held.release());
  const workspace = path.join(held.root, 'work');
  await using removeWorkspace = onAsyncExit(() =>
    fs.rm(workspace, { recursive: true, force: true }),
  );
  const copy = async (name: string) => {
    const metadata = name.startsWith('metadata/');
    const relative = name.slice(metadata ? 9 : 7);
    const ready = await (metadata
      ? base.ensureMetadataFile(relative)
      : base.ensurePublicFile(relative));
    if (!ready) throw new Error('Native derivative input is absent: ' + name);
    const target = path.join(workspace, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(base.root, name), target, constants.COPYFILE_FICLONE);
  };
  await copy('metadata/library/receipt.json');
  for (const id of packedCombatEffects) {
    const file = combatEffectCatalog[id]!;
    await copy('public/' + file);
    const manifest = parseManifest(
      JSON.parse(await fs.readFile(path.join(workspace, 'public', file), 'utf8')),
    );
    for (const page of manifest.pages)
      await copy('public/' + path.posix.join(path.posix.dirname(file), page.path));
  }
  const context = await createPreparationContext({
    workspace,
    budget: 256 * 1024 ** 2,
    sourceRoot: sourceLibrary(),
    libraryRoot: sourceLibraryRoot(),
  });
  await prepare(context);
  await context.writeAsset(
    'metadata/game-effects/receipt.json',
    await context.readAsset('staging/game-effects/receipt.json'),
  );
  const files = Object.fromEntries(
    Object.entries(inventory.files).filter(
      ([name]) =>
        !name.startsWith('public/generated/game-effects/') &&
        name !== 'metadata/game-effects/receipt.json',
    ),
  );
  const outputs = [
    ...(await listFiles(path.join(workspace, 'public/generated/game-effects'))).map(
      (name) => 'public/generated/game-effects/' + name,
    ),
    'metadata/game-effects/receipt.json',
  ];
  for (const name of outputs) {
    const bytes = await fs.readFile(path.join(workspace, name));
    files[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  const inputs = {
    'game-effects:base-payload': pin.preparation.inputs['game-effects:base-payload'] ?? pin.sha256,
    'game-effects:base-recipe':
      pin.preparation.inputs['game-effects:base-recipe'] ?? pin.recipeSha256,
    'effect-receipt': files['metadata/game-effects/receipt.json']!.sha256,
    'tools/assets/prepare/prepare-game-effects.ts': hash(
      await fs.readFile(path.join(projectRoot, 'tools/assets/prepare/prepare-game-effects.ts')),
    ),
    'tools/compiler.ts': hash(await fs.readFile(path.join(projectRoot, 'tools/compiler.ts'))),
    'tools/assets/game-effects-snapshot.ts': hash(
      await fs.readFile(path.join(projectRoot, 'tools/assets/game-effects-snapshot.ts')),
    ),
    'src/assets/schema.ts': hash(await fs.readFile(path.join(projectRoot, 'src/assets/schema.ts'))),
    'src/content/combat-feedback.ts': hash(
      await fs.readFile(path.join(projectRoot, 'src/content/combat-feedback.ts')),
    ),
    dependencies: hash(JSON.stringify({ sharp: (await import('sharp')).default.versions })),
  };
  const recipeSha256 = hash(JSON.stringify(inputs));
  const next = { schemaVersion: 1 as const, recipeSha256, files };
  const preparation = { recipeSha256, inputs, payloadSha256: payloadDigest(next) };
  await saveRepositoryAssets(workspace, next, preparation, projectRoot, {
    inventory,
    expectedPin: pin.sha256,
  });
}
