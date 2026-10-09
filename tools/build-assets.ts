import fs from 'node:fs/promises';
import path from 'node:path';
import { safeRelative } from './assets/paths';
import { shaFile } from './assets/sources';

// CI transfers code/manifests once. Native media comes from the immutable pin
// already acquired for package verification, rather than a second giant upload.
export async function restoreBuildAssets(
  root: string,
  workspace: string,
  assetSha256: string,
  commit?: string,
) {
  let restored = 0;
  for (const dist of ['dist', 'dist-dev']) {
    const identity = JSON.parse(
      await fs.readFile(path.join(root, dist, 'build-identity.json'), 'utf8'),
    ) as {
      sourceCommit: string;
      dirty: boolean;
      assets: { sha256: string };
      files: Record<string, string>;
    };
    if (
      identity.assets.sha256 !== assetSha256 ||
      (commit && (identity.sourceCommit !== commit || identity.dirty))
    )
      throw new Error('Build assets belong to another pin or commit');
    for (const [name, expected] of Object.entries(identity.files)) {
      safeRelative(name);
      if (!name.startsWith(dist + '/') || !/\.(?:png|mp4)$/.test(name)) continue;
      const target = path.join(root, name);
      const exists = await fs.access(target).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (exists) {
        if ((await shaFile(target)) !== expected) throw new Error('Build media differs: ' + name);
        continue;
      }
      const source = path.join(workspace, 'public', name.slice(dist.length + 1));
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || (await shaFile(source)) !== expected)
        throw new Error('Pinned media differs from build identity: ' + name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      restored++;
    }
  }
  console.log(`Restored ${restored} missing native media files from the verified asset pin.`);
}
