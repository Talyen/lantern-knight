import fs from 'node:fs/promises';
import { projectRoot } from './paths';
import { retainedAssetCatalog } from './selection';
import { runCli } from '../cli';
import { onAsyncExit } from '../scope-exit';
import { readJson } from '../json-file';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AssetCache } from './cache';
import { openWorkspace } from './workspace';
import { readLock } from './pack';
import { preparePreviewAssets } from './preview';
import { prepareAssets } from './prepare';
import { saveRepositoryAssets } from './repository';
import { PackSchema, preparationPin, recipeInputs } from './pack';
import { preparePublicationCandidate } from './prepare';
import { prototypeAssets } from './preview';
import { readAuthoringCatalog } from './authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
import { checkAssets, checkBuiltAssets } from '../check-assets';
import { acquireCommandLane } from '../command-lane';
import { discoverLibrary } from './discovery';
import { publishIndividualFiles } from './file-publication';
import { cleanRepositoryAssemblies } from './repository-cache';
import { prepareGameEffectsSnapshot } from './game-effects-snapshot';

export function parseAssetArgs(input: string[]) {
  const [command, ...args] = input;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ids: { type: 'boolean' },
      local: { type: 'boolean' },
      proof: { type: 'boolean' },
      gpu: { type: 'boolean' },
      built: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
  });
  if (values['dry-run'] && command !== 'clean') throw new Error('--dry-run is for assets:clean');
  if (command === 'prepare') {
    if (values.local) throw new Error('--local is for asset inspection/checks, not preparation');
    if (values.ids && values.proof) throw new Error('Use --ids or --proof, not both');
    if ((values.ids && !positionals.length) || (!values.ids && positionals.length))
      throw new Error('Use assets:prepare, --ids <asset-id>... or --proof');
  }
  return { command, args, values, positionals };
}

async function main() {
  const { command, args, values, positionals } = parseAssetArgs(process.argv.slice(2));
  if (values.built) {
    if (command !== 'check' || args.length !== 1) throw new Error('Use assets:check -- --built');
    await checkBuiltAssets();
    return;
  }
  if (command === 'publish-files') {
    if (args.length) throw new Error('Use assets:publish-files without options');
    const pin = await readLock();
    if (pin.schemaVersion === 5) {
      console.log('Assets are stored in this repository; no delivery publication is needed.');
      return;
    }
    if (pin.schemaVersion !== 3 && pin.schemaVersion !== 4)
      throw new Error('Individual delivery requires an accepted file-capable pin');
    await publishIndividualFiles(pin);
  } else if (command === 'prepare' || command === 'publish') {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    if (
      command === 'publish' &&
      (positionals.length || values.ids || values.local || values.proof || values.gpu)
    )
      throw new Error('Use assets:publish without options');
    const lane = await acquireCommandLane({ command: 'assets:' + command });
    await using _cleanup3 = onAsyncExit(() => lane.release());
    const cache = new AssetCache();
    await cache.initialize();
    if (
      command === 'prepare' &&
      values.ids &&
      positionals.length === 1 &&
      positionals[0] === 'game-effects'
    ) {
      await prepareGameEffectsSnapshot(cache);
      return;
    }
    const started = performance.now();
    const retainedFile = path.join(projectRoot, 'assets/retained.json');
    const retained = (await readJson(retainedFile)) as { assets: string[] };
    const ids =
      command === 'prepare' && values.ids
        ? positionals.filter((id) => id.startsWith('library-') && id !== 'library-all')
        : [];
    const assets = [...new Set([...retained.assets, ...ids])].sort();
    const scenes = Object.keys(await retainedAssetCatalog({}, undefined, assets)).sort();
    const retainedText = JSON.stringify({ assets, scenes }, null, 2) + '\n';
    if (retainedText !== (await fs.readFile(retainedFile, 'utf8')))
      await fs.writeFile(retainedFile, retainedText);
    const env = await discoverLibrary(cache, process.env);
    console.log(`Source reconciliation: ${((performance.now() - started) / 1000).toFixed(2)}s.`);
    env.LANTERN_IMAGE_GPU = '1';
    env.LANTERN_PREPARE_BUDGET = process.env.LANTERN_PREPARE_BUDGET ?? String(cache.limit);
    if (command === 'prepare' && !values.proof) {
      await preparePreviewAssets(positionals, cache, env);
      const base = await prototypeAssets(cache);
      await using releaseBase = onAsyncExit(() => base.held.release());
      if (!base.files) throw new Error('Missing prepared asset inventory');
      const prepared = await preparePublicationCandidate(
        base.held.root,
        base.lock.recipeSha256,
        base.files,
        cache,
      );
      await using releasePrepared = onAsyncExit(() => prepared.held.release());
      await checkAssets({ publicDirectory: path.join(prepared.payload, 'public') });
      const inventory = PackSchema.parse(await readJson(path.join(prepared.payload, 'pack.json')));
      const accepted = preparationPin(prepared.lock, await recipeInputs(), inventory);
      if (accepted.schemaVersion === 1) throw new Error('Missing preparation provenance');
      await saveRepositoryAssets(prepared.payload, inventory, accepted.preparation);
    } else {
      const prepared = await prepareAssets(cache, !!values.proof, env);
      await using _cleanup1 = onAsyncExit(() => prepared.held.release());
      if (command === 'publish') {
        await checkAssets({ publicDirectory: path.join(prepared.payload, 'public') });
        const inventory = PackSchema.parse(
          await readJson(path.join(prepared.payload, 'pack.json')),
        );
        const accepted = preparationPin(prepared.lock, await recipeInputs(), inventory);
        if (accepted.schemaVersion === 1) throw new Error('Missing preparation provenance');
        await saveRepositoryAssets(prepared.payload, inventory, accepted.preparation);
      }
    }
    console.log(
      `Asset ${command} completed in ${((performance.now() - started) / 1000).toFixed(2)}s.`,
    );
  } else if (command === 'clean') {
    if (args.some((arg) => arg !== '--dry-run')) throw new Error('Use assets:clean [--dry-run]');
    const cache = new AssetCache();
    await cache.initialize();
    const pin = await readLock();
    const keep = new Set([
      'pack-' + pin.sha256,
      'pack-' + pin.sha256 + '-runtime',
      'pack-' + pin.sha256 + '-authoring',
      ...((pin.schemaVersion === 3 || pin.schemaVersion === 4) && pin.fileDelivery
        ? ['files-' + pin.fileDelivery.sha256]
        : []),
      ...(pin.schemaVersion === 3
        ? Object.values(pin.bundles).map((part) => 'pack-' + part.sha256)
        : []),
    ]);
    const dryRun = values['dry-run'] === true;
    const repository = await cleanRepositoryAssemblies(projectRoot, {
      keep: new Set([pin.sha256]),
      all: true,
      dryRun,
    });
    const bytes = repository.removed.reduce((sum, entry) => sum + entry.bytes, 0);
    console.log(
      `${dryRun ? 'Would remove' : 'Removed'} ${await cache.clean(keep, dryRun)} shared cache entries and ${repository.removed.length} repository assemblies (${(bytes / 1024 ** 2).toFixed(1)} MiB logical).`,
    );
  } else if (command === 'inspect' || command === 'check') {
    if (
      (command === 'check' && positionals.length) ||
      (command === 'inspect' && positionals.length > 1) ||
      values.ids ||
      values.proof ||
      values.gpu
    )
      throw new Error('Invalid asset inspection/check arguments');
    const workspace = await openWorkspace(
      values.local ? 'local' : 'pinned',
      'authoring',
      command === 'inspect',
    );
    await using _cleanup2 = onAsyncExit(() => workspace.release());
    if (command === 'check') await checkAssets(workspace);
    else {
      const ensure = async (file: string) => {
        if (workspace.ensurePublicFile && !(await workspace.ensurePublicFile(file)))
          throw new Error('Asset file is absent from the workspace: ' + file);
      };
      await ensure('generated/library/catalog.json');
      const catalog = await readAuthoringCatalog(workspace.publicDirectory),
        id = positionals[0];
      if (!id) console.log(`${Object.keys(catalog).length} assets. Supply an asset ID.`);
      else {
        if (!Object.hasOwn(catalog, id)) throw new Error('Unknown asset: ' + id);
        await ensure(catalog[id]!);
        const m = parseManifest(await readJson(path.join(workspace.publicDirectory, catalog[id]!)));
        console.log(
          JSON.stringify(
            {
              id,
              canvas: m.asset.canvas,
              density: m.asset.density,
              frames: m.frames.length,
              pages: m.pages.length,
              clips: Object.keys(m.asset.clips),
            },
            null,
            2,
          ),
        );
      }
    }
  } else throw new Error('Use assets:prepare|inspect|publish|publish-files|clean|check');
}
runCli(import.meta.url, () => main());
