import { createHash } from 'node:crypto';
import { selectRegistration } from '../src/assets/registration';
import type { RuntimeBundles } from '../src/assets/byte-source';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function gameRegistration(registration: Buffer, policy: Buffer, assets: Iterable<string>) {
  const flags = JSON.parse(policy.toString());
  if (digest(registration) !== flags.registrationHash)
    throw new Error('Prepared registration hash differs');
  const text = JSON.stringify(selectRegistration(JSON.parse(registration.toString()), assets));
  return { registration: text, policy: { ...flags, registrationHash: digest(text) } };
}
// Repackage authenticated prepared bytes. No pixel encoding or source-art preparation.
export async function runtimeBundles(
  groups: ReadonlyMap<string, ReadonlySet<string>>,
  read: (file: string) => Promise<Buffer>,
) {
  const bundles: RuntimeBundles = [],
    binary: Record<string, Buffer> = {},
    seen = new Set<string>();
  for (const [asset, files] of groups) {
    let parts: Buffer[] = [],
      entries: RuntimeBundles[number]['files'] = {},
      bytes = 0,
      index = 0;
    const finish = () => {
      if (!bytes) return;
      const data = Buffer.concat(parts),
        hash = digest(data),
        path = `runtime-assets/${asset}-${index++}-${hash}.bin`;
      bundles.push({ path, hash, bytes, files: entries });
      binary[path] = data;
      parts = [];
      entries = {};
      bytes = 0;
    };
    for (const file of [...files].sort()) {
      if (seen.has(file)) continue;
      const data = await read(file);
      if (!data.length || data.length > 512 * 1024) continue;
      if (bytes + data.length > 32 * 1024 ** 2) finish();
      seen.add(file);
      entries[file] = { offset: bytes, bytes: data.length, hash: digest(data) };
      parts.push(data);
      bytes += data.length;
    }
    finish();
  }
  return { bundles, binary };
}
