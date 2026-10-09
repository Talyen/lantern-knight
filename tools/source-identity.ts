import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readLock } from './assets/pack';
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, item]) => [k, canonical(item)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export async function sourceFingerprint(
  root: string,
  options: {
    ignoreAssetPin?: boolean;
    scope?: 'runtime' | 'verification';
    files?: readonly string[];
  } = {},
) {
  const names = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const file of names) {
    if (options.ignoreAssetPin && file === 'assets/lock.json') continue;
    if (options.files && !options.files.includes(file)) continue;
    if (
      options.scope === 'runtime' &&
      !/^(src|electron|authoring)\/|^(package(?:-lock)?\.json|vite\.config\.ts|.*\.html|assets\/lock\.json)$/.test(
        file,
      )
    )
      continue;
    if (!/\.(ts|cjs|json|css|html|md|py|yml|toml)$/.test(file) || file.startsWith('references/'))
      continue;
    const stat = await fs.lstat(path.join(root, file)).catch((e) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Authored inputs cannot follow symlink: ' + file);
    hash.update(file).update(await fs.readFile(path.join(root, file)));
  }
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    sha256: hash.digest('hex'),
  };
}
export async function sourceIdentity(root: string) {
  const source = await sourceFingerprint(root, { scope: 'runtime' }),
    lock = await readLock((name) => fs.readFile(path.join(root, name)));
  return {
    ...source,
    identityVersion: 4 as const,
    assetSha256: lock.sha256,
    archiveRecipeSha256: lock.recipeSha256,
    preparationRecipeSha256: lock.recipeSha256,
  };
}
