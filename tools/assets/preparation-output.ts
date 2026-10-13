import path from 'node:path';
import { hash } from '../compiler';
import type { Source } from '../../src/assets/schema';
import type { PreparationContext } from './context';

export function preparationOutput(
  context: Pick<PreparationContext, 'readAsset' | 'writeAsset' | 'compile'>,
  check: boolean,
) {
  async function write(file: string, bytes: Buffer | string) {
    if (!check) return context.writeAsset(file, bytes);
    if (!Buffer.from(bytes).equals(await context.readAsset(file)))
      throw new Error('Stale prepared output: ' + file);
  }
  async function compile(source: string, out: string) {
    const manifest = await context.compile(source, out, check);
    if (check) {
      if (
        JSON.stringify(manifest) !==
        JSON.stringify(JSON.parse(await context.readAsset(path.join(out, 'manifest.json'), 'utf8')))
      )
        throw new Error('Stale prepared manifest: ' + source);
      for (const page of manifest.pages)
        if (hash(await context.readAsset(path.join(out, page.path))) !== page.hash)
          throw new Error('Stale prepared page: ' + path.join(out, page.path));
    }
    return manifest;
  }
  async function pack(source: Source, group = 'ink', outputGroup = group) {
    const file = `${group}/${source.asset.id}.json`;
    await write('staging/' + file, JSON.stringify(source, null, 2) + '\n');
    return compile(file, `public/generated/${outputGroup}/${source.asset.id}`);
  }
  return { write, compile, pack };
}
