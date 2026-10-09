import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetCache } from './cache';
import { readLock } from './pack';
import { projectRoot } from './paths';
import { preparationSelection } from './recipe';
import { runNpmTask } from '../task-runner';
import type { Invocation } from '../task-context';
export function preparationArgs(args: string[]) {
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--proof') continue;
    if (args[i] !== '--ids' || ids.length)
      throw new Error('Use assets:prepare [--proof] [--ids <asset-id>...]');
    while (i + 1 < args.length && !args[i + 1]!.startsWith('--')) ids.push(args[++i]!);
    if (!ids.length) throw new Error('Supply asset IDs after --ids');
  }
  if (ids.length) preparationSelectionForArgs(ids);
  if (ids.length && args.includes('--proof'))
    throw new Error('Ground proof requires full explicit preparation');
  return ids;
}
function preparationSelectionForArgs(ids: string[]) {
  for (const id of ids)
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error('Invalid asset ID: ' + id);
  preparationSelection(ids);
}
export async function currentPin({ local }: Invocation) {
  await (await import('../check-asset-pin')).checkCurrentAssetPin(projectRoot, local);
  console.log(
    'PASS: authored asset inputs match the ' +
      (local ? 'local preparation' : 'published pack pin') +
      '; no artwork acquired.',
  );
}
export async function finalize({ context, args }: Invocation) {
  await (
    await import('./finalize')
  ).finalizeAssets(args, async (argv) => {
    let log = '';
    await runNpmTask(context, argv, (chunk) => {
      log = (log + chunk.toString()).slice(-12000);
      process.stdout.write(chunk);
    });
    return { output: log, captureDirectories: context.captureDirectories ?? [] };
  });
}
export async function prepare({ clean, env }: Invocation) {
  const ids = preparationArgs(clean);
  if (ids.length) {
    await (await import('./preview')).preparePreviewAssets(ids, new AssetCache(), env);
    return;
  }
  const prepared = await (
    await import('./prepare')
  ).prepareAssets(new AssetCache(), clean.includes('--proof'), env);
  await prepared.held.release();
}
export async function inspectAssets({ definition, clean, env }: Invocation) {
  if (definition.inspection) {
    const assetCatalog = await (
      await import('./authoring-catalog')
    ).readAuthoringCatalog(path.join(env.LANTERN_ASSET_WORKSPACE!, 'public'));
    const { parseManifest } = await import('../../src/assets/schema');
    const id = clean[0];
    if (!id) {
      console.log(`${Object.keys(assetCatalog).length} assets. Supply an asset ID.`);
      return;
    }
    const file = assetCatalog[id];
    if (!file) throw new Error('Unknown asset ID');
    const manifest = parseManifest(
      JSON.parse(
        await fs.readFile(path.join(env.LANTERN_ASSET_WORKSPACE!, 'public', file), 'utf8'),
      ),
    );
    console.log(
      JSON.stringify(
        {
          id,
          canvas: manifest.asset.canvas,
          density: manifest.asset.density,
          frames: manifest.frames.length,
          pages: manifest.pages.length,
          clips: Object.keys(manifest.asset.clips),
        },
        null,
        2,
      ),
    );
  }
}
export async function cleanAssets() {
  const { retainedPacks, obsoleteReleases, gh } = await import('./retention');
  const cache = new AssetCache(),
    keep = await retainedPacks(await readLock()),
    obsolete = await obsoleteReleases(keep);
  for (const tag of obsolete) await gh(['release', 'delete', tag, '--cleanup-tag', '--yes']);
  const names = await fs.readdir(path.join(cache.root, 'entries'));
  const removed = await cache.clean(
    new Set(names.filter((n) => n.startsWith('pack-') && keep.has('assets-' + n.slice(5, 21)))),
  );
  console.log(`Cleaned ${obsolete.length} published packs and ${removed} unused entries.`);
}
