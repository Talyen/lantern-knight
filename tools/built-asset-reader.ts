import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetByteSource } from '../src/assets/byte-source';
import { safeRelative } from './assets/files';

// Validation and test fixtures consume the same authenticated ranges as Game.
// The reader owns only its bounded byte cache; callers own returned copies.
export async function builtAssetReader(root: string) {
  const policy = JSON.parse(await fs.readFile(path.join(root, 'build-mode.json'), 'utf8'));
  const source = new AssetByteSource(policy.assetBundles, async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const name = url.replace(/^\//, '');
    const bytes = await fs.readFile(path.join(root, safeRelative(name)));
    return new Response(new Uint8Array(bytes));
  });
  return {
    files: (policy.assetBundles ?? []).flatMap((bundle: { files: Record<string, unknown> }) =>
      Object.keys(bundle.files),
    ) as string[],
    read: async (name: string) => {
      const response = await source.request('/' + safeRelative(name));
      return Buffer.from(await response.arrayBuffer());
    },
    dispose: () => source.dispose(),
  };
}

// Asset fixtures deliberately mutate independent images. Expand only in their
// disposable copy, after authenticating the actual shipped artifact.
export async function materializeBuiltAssets(root: string) {
  const reader = await builtAssetReader(root);
  try {
    for (const name of reader.files) {
      const target = path.join(root, safeRelative(name));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await reader.read(name));
    }
  } finally {
    reader.dispose();
  }
}
