import { readJson } from '../json-file';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AssetCache } from './cache';
import { openWorkspace } from './workspace';
import { readLock } from './pack';
import { preparePreviewAssets } from './preview';
import { prepareAssets } from './prepare';
import { publishBundledPrepared } from './publication';
import { readAuthoringCatalog } from './authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
import { checkAssets } from '../check-assets';
import { acquireCommandLane } from '../command-lane';
import { discoverLibrary } from './discovery';
import { publishIndividualFiles } from './file-publication';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ids: { type: 'boolean' },
      local: { type: 'boolean' },
      proof: { type: 'boolean' },
      gpu: { type: 'boolean' },
    },
  });
  if (command === 'publish-files') {
    if (args.length) throw new Error('Use assets:publish-files without options');
    const pin = await readLock();
    if (pin.schemaVersion !== 3) throw new Error('Individual delivery requires a bundled pin');
    await publishIndividualFiles(pin);
  } else if (command === 'prepare' || command === 'publish') {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    if (
      command === 'publish' &&
      (positionals.length || values.ids || values.local || values.proof || values.gpu)
    )
      throw new Error('Use assets:publish without options');
    if (
      command === 'prepare' &&
      ((values.ids && !positionals.length) || (!values.ids && positionals.length))
    )
      throw new Error('Use assets:prepare, --ids <asset-id>... or --proof');
    const lane = await acquireCommandLane({ command: 'assets:' + command });
    try {
      const cache = new AssetCache();
      await cache.initialize();
      const started = performance.now();
      const env = await discoverLibrary(cache, process.env);
      console.log(`Source reconciliation: ${((performance.now() - started) / 1000).toFixed(2)}s.`);
      env.LANTERN_IMAGE_GPU = '1';
      env.LANTERN_PREPARE_BUDGET = process.env.LANTERN_PREPARE_BUDGET ?? String(cache.limit);
      if (command === 'prepare' && !values.proof) {
        if (values.proof) throw new Error('Use --ids or --proof');
        await preparePreviewAssets(positionals, cache, env);
      } else {
        const prepared = await prepareAssets(cache, !!values.proof, env);
        try {
          if (command === 'publish') {
            await checkAssets({ publicDirectory: path.join(prepared.payload, 'public') });
            await publishBundledPrepared(prepared);
          }
        } finally {
          await prepared.held.release();
        }
      }
      console.log(
        `Asset ${command} completed in ${((performance.now() - started) / 1000).toFixed(2)}s.`,
      );
    } finally {
      await lane.release();
    }
  } else if (command === 'clean') {
    if (args.length) throw new Error('Use assets:clean without options');
    const cache = new AssetCache();
    await cache.initialize();
    const pin = await readLock();
    const keep = new Set([
      'pack-' + pin.sha256,
      'pack-' + pin.sha256 + '-runtime',
      'pack-' + pin.sha256 + '-authoring',
      ...(pin.schemaVersion === 3 && pin.fileDelivery ? ['files-' + pin.fileDelivery.sha256] : []),
      ...(pin.schemaVersion === 3
        ? Object.values(pin.bundles).map((part) => 'pack-' + part.sha256)
        : []),
    ]);
    console.log(
      `Removed ${await cache.clean(keep)} unused local cache entries. Published releases and original sources are retained.`,
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
      command === 'inspect' ? 'authoring' : 'runtime',
    );
    try {
      if (command === 'check') await checkAssets(workspace);
      else {
        const catalog = await readAuthoringCatalog(workspace.publicDirectory),
          id = positionals[0];
        if (!id) console.log(`${Object.keys(catalog).length} assets. Supply an asset ID.`);
        else {
          if (!Object.hasOwn(catalog, id)) throw new Error('Unknown asset: ' + id);
          const m = parseManifest(
            await readJson(path.join(workspace.publicDirectory, catalog[id]!)),
          );
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
    } finally {
      await workspace.release();
    }
  } else throw new Error('Use assets:prepare|inspect|publish|publish-files|clean|check');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
