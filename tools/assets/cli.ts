import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AssetCache } from './cache';
import { openWorkspace, workspaceEnvironment } from './workspace';
import { readLock } from './pack';
import { preparePreviewAssets } from './preview';
import { prepareAssets } from './prepare';
import { publishBundledPrepared } from './publication';
import { readAuthoringCatalog } from './authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
import { runProcess } from '../run-process';
import { acquireCommandLane } from '../command-lane';
import { projectRoot } from './paths';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ids: { type: 'boolean' }, local: { type: 'boolean' }, proof: { type: 'boolean' } },
  });
  if (command === 'prepare' || command === 'publish') {
    if (command === 'publish' && (positionals.length || values.ids || values.local || values.proof))
      throw new Error('Use assets:publish without options');
    if (command === 'prepare' && (!values.ids || !positionals.length) && !values.proof)
      throw new Error('Use assets:prepare --ids <asset-id>... or --proof');
    const lane = await acquireCommandLane({ command: 'assets:' + command });
    try {
      if (command === 'prepare' && values.ids) {
        if (values.proof) throw new Error('Use --ids or --proof');
        await preparePreviewAssets(positionals, new AssetCache(), process.env);
      } else {
        const prepared = await prepareAssets(new AssetCache(), !!values.proof);
        try {
          if (command === 'publish') {
            await runProcess(process.execPath, ['--import', 'tsx', 'tools/check-assets.ts'], {
              cwd: projectRoot,
              env: workspaceEnvironment({
                root: prepared.payload,
                identity: prepared.lock.sha256,
                recipe: prepared.lock.recipeSha256,
                release: async () => {},
              }),
              timeoutMs: 5 * 60_000,
            });
            await publishBundledPrepared(prepared);
          }
        } finally {
          await prepared.held.release();
        }
      }
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
      values.proof
    )
      throw new Error('Invalid asset inspection/check arguments');
    const workspace = await openWorkspace(
      values.local ? 'local' : 'pinned',
      command === 'inspect' ? 'authoring' : 'runtime',
    );
    try {
      if (command === 'check')
        await runProcess(process.execPath, ['--import', 'tsx', 'tools/check-assets.ts'], {
          cwd: projectRoot,
          env: workspaceEnvironment(workspace),
          timeoutMs: 5 * 60_000,
        });
      else {
        const catalog = await readAuthoringCatalog(path.join(workspace.root, 'public')),
          id = positionals[0];
        if (!id) console.log(`${Object.keys(catalog).length} assets. Supply an asset ID.`);
        else {
          if (!Object.hasOwn(catalog, id)) throw new Error('Unknown asset: ' + id);
          const m = parseManifest(
            JSON.parse(
              await fs.readFile(path.join(workspace.root, 'public', catalog[id]!), 'utf8'),
            ),
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
  } else throw new Error('Use assets:prepare|inspect|publish|clean|check');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
