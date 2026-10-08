import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const CACHE_LIMIT = 4 * 1024 ** 3;
export function cacheRoot() {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches')
      : process.platform === 'win32'
        ? (process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'))
        : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'));
  return path.resolve(process.env.LANTERN_CACHE_ROOT ?? path.join(base, 'LanternKnight'));
}
export function safeRelative(file: string) {
  if (
    !file ||
    file.includes('\\') ||
    path.posix.isAbsolute(file) ||
    file.split('/').some((p) => !p || p === '.' || p === '..' || p.includes(':'))
  )
    throw new Error(`Unsafe asset path: ${file}`);
  return file;
}
export function assetRoot() {
  if (process.env.LANTERN_ASSET_WORKSPACE) return path.resolve(process.env.LANTERN_ASSET_WORKSPACE);
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'assets/lock.json'), 'utf8')) as {
    sha256: string;
  };
  if (!/^[a-f0-9]{64}$/.test(lock.sha256)) throw new Error('Invalid asset pack hash');
  return path.join(cacheRoot(), 'entries', `pack-${lock.sha256}`);
}
export const publicRoot = () => path.join(assetRoot(), 'public');
export const publicFile = (file: string) => path.join(publicRoot(), safeRelative(file));
export const metadataFile = (file: string) =>
  path.join(assetRoot(), 'metadata', safeRelative(file));
export function stagingRoot() {
  if (process.env.LANTERN_PREPARING !== '1' || !process.env.LANTERN_ASSET_WORKSPACE)
    throw new Error('Asset generation requires assets:prepare; builds consume prepared assets.');
  return path.join(assetRoot(), 'staging');
}
export const stagingFile = (file: string) => path.join(stagingRoot(), safeRelative(file));
export function sourceLibrary() {
  const sources = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'assets/sources.json'), 'utf8'),
  ) as { libraryDirectory: string };
  return path.join(
    process.env.ASSET_LIBRARY_ROOT ?? path.join(os.homedir(), 'Documents', 'Asset Library'),
    safeRelative(sources.libraryDirectory),
  );
}
export function assetFile(file: string) {
  if (path.isAbsolute(file)) return file;
  if (path.sep === '\\') file = file.split(path.sep).join('/');
  if (file === 'public') return publicRoot();
  if (file.startsWith('public/')) return publicFile(file.slice(7));
  if (file === 'staging') return stagingRoot();
  if (file.startsWith('staging/')) {
    if (process.env.LANTERN_PREPARING === '1') return stagingFile(file.slice(8));
    if (file === 'staging/animation/flow.png') return publicFile('animation/flow.png');
    return metadataFile(file.slice(8));
  }
  if (file.startsWith('references/art/')) {
    const [group, ...rest] = file.slice(15).split('/');
    return path.join(sourceLibrary(), 'Project Sources', safeRelative(group!), ...rest);
  }
  return path.join(projectRoot, file);
}
