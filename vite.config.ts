import { defineConfig } from 'vite';
import path from 'node:path';
import { publicRoot } from './tools/assets/paths.ts';
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  plugins:
    mode === 'sandbox'
      ? [
          {
            name: 'lantern-scene-editor',
            async configureServer(server) {
              const { sceneEditorPlugin } = (await server.ssrLoadModule(
                '/tools/scene/scene-editor-store.ts',
              )) as typeof import('./tools/scene/scene-editor-store.ts');
              const configure = sceneEditorPlugin(
                process.cwd(),
                server.config.publicDir,
              ).configureServer;
              if (typeof configure !== 'function')
                throw new Error('Scene editor server hook is unavailable');
              return configure.call(this, server);
            },
          },
        ]
      : [],
  publicDir: publicRoot(),
  server: {
    port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
    strictPort: true,
    watch: {
      ignored: (file: string) =>
        /^(?:dist(?:-[^/]*)?|release(?:-[^/]*)?|staging|tmp)(\/|$)/.test(
          path.relative(process.cwd(), file).split(path.sep).join('/'),
        ),
    },
    fs: { allow: [process.cwd(), publicRoot()] },
  },
  build: {
    copyPublicDir: false,
    outDir: mode === 'sandbox' ? 'dist-dev' : 'dist',
    rolldownOptions: {
      input:
        mode === 'sandbox'
          ? {
              game: path.resolve('index.html'),
              sandbox: path.resolve('sandbox.html'),
              effects: path.resolve('effects.html'),
              editor: path.resolve('editor.html'),
            }
          : path.resolve('index.html'),
    },
  },
}));
