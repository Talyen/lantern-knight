const dev = process.argv.includes('--dev');
import { build } from 'esbuild';
await build({
  entryPoints: ['electron/main.ts'],
  outfile: `${dev ? 'dist-electron-dev' : 'dist-electron'}/main.cjs`,
  define: { __DEV_APP__: String(dev) },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
});
await build({
  entryPoints: ['electron/preload.ts'],
  outfile: `${dev ? 'dist-electron-dev' : 'dist-electron'}/preload.cjs`,
  define: { __DEV_APP__: String(dev) },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
});
