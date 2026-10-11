import path from 'node:path';
import fs from 'node:fs/promises';
import { runProcess } from '../run-process';
import { AssetCache } from './cache';
import { projectRoot, sourceLibrary } from './paths';

export async function discoverLibrary(
  cache: AssetCache,
  env: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const index = path.join(cache.root, 'discovery', 'sources.json');
  const inventory = path.join(cache.root, 'discovery', 'inventory.json');
  await runProcess(
    'python3',
    [
      '-B',
      path.join(projectRoot, 'tools/assets/discovery.py'),
      '--root',
      sourceLibrary(env),
      '--index',
      path.join(projectRoot, 'assets/sources.json'),
      '--extra-index',
      path.join(projectRoot, 'assets/loading-sources.json'),
      '--output-index',
      index,
      '--output-inventory',
      inventory,
    ],
    { cwd: projectRoot, env, timeoutMs: 10 * 60_000 },
  );
  const data = JSON.parse(await fs.readFile(inventory, 'utf8'));
  return {
    ...env,
    LANTERN_LIBRARY_INDEX: index,
    LANTERN_LIBRARY_INVENTORY: inventory,
    LANTERN_LIBRARY_SHA256: data.sha256 as string,
  };
}
