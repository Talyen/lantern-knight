import { readJson } from '../json-file';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runProcess } from '../run-process';
import { AssetCache } from './cache';
import { projectRoot, sourceLibrary } from './paths';

// Discovery hashes changed files/archives and retains hashes only while their
// inode, size and nanosecond modification/change times match. Member hashes are
// therefore proofs for the current verified archive, not filename guesses.
export async function sourceSnapshot(env: NodeJS.ProcessEnv) {
  if (!env.LANTERN_LIBRARY_INDEX || !env.LANTERN_LIBRARY_INVENTORY) return;
  const [index, inventory] = await Promise.all([
    fs.readFile(env.LANTERN_LIBRARY_INDEX, 'utf8').then(JSON.parse),
    fs.readFile(env.LANTERN_LIBRARY_INVENTORY, 'utf8').then(JSON.parse),
  ]);
  if (inventory.discoveryVersion < 8 || inventory.sha256 !== env.LANTERN_LIBRARY_SHA256)
    throw new Error('Source inventory differs from the verified discovery snapshot');
  const archives = new Map<string, Map<string, string>>();
  for (const file of inventory.files)
    if (file.kind === 'archive')
      archives.set(
        file.sha256,
        new Map(file.members.map((m: { member: string; sha256: string }) => [m.member, m.sha256])),
      );
  const hash = (group: string, member: string): string | undefined => {
    const file = index.files[group]?.[member];
    if (file) return file.sha256;
    const names = index.archiveGroups?.[group]
      ? [index.archiveGroups[group]]
      : group === 'ink-collection-01'
        ? (index.prefixes[member.split('/')[0]!] ?? [])
        : [];
    const hashes = names.flatMap((name: string) => {
      const value = archives.get(index.archives[name]?.sha256)?.get(member);
      return value ? [value] : [];
    });
    return hashes.length && hashes.every((value: string) => value === hashes[0])
      ? hashes[0]
      : undefined;
  };
  return (source: { group: string; member: string; sha256: string }) =>
    hash(source.group, source.member) === source.sha256;
}

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
  const data = await readJson(inventory);
  return {
    ...env,
    LANTERN_LIBRARY_INDEX: index,
    LANTERN_LIBRARY_INVENTORY: inventory,
    LANTERN_LIBRARY_SHA256: data.sha256 as string,
  };
}
