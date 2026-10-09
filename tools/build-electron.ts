import { build, type Metafile, type BuildOptions } from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function verifyElectronImports(metadata: Pick<Metafile, 'outputs'>) {
  for (const output of Object.values(metadata.outputs))
    for (const entry of output.imports)
      if (
        entry.external &&
        entry.path !== 'electron' &&
        !builtinModules.includes(entry.path) &&
        !builtinModules.includes(entry.path.replace(/^node:/, ''))
      )
        throw new Error('Electron bundle requires an unbundled runtime dependency: ' + entry.path);
}
export function electronConfig(name: 'main' | 'preload', dev: boolean): BuildOptions {
  return {
    entryPoints: [`electron/${name}.ts`],
    outfile: `${dev ? 'dist-electron-dev' : 'dist-electron'}/${name}.cjs`,
    define: { __DEV_APP__: String(dev) },
    bundle: true,
    metafile: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['electron'],
  };
}
export async function buildElectron(dev: boolean) {
  for (const name of ['main', 'preload'] as const) {
    const result = await build(electronConfig(name, dev));
    verifyElectronImports(result.metafile!);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildElectron(process.argv.includes('--dev'));
