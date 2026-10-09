import { defineConfig, type UserConfig } from 'vite';
import path from 'node:path';
import { openWorkspace } from './tools/assets/workspace';
export function webConfig(publicDirectory: string, authoring: boolean): UserConfig {
  return {
    clearScreen: false,
    plugins: authoring
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
    publicDir: publicDirectory,
    server: {
      port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
      strictPort: true,
      watch: {
        ignored: (file: string) =>
          /^(?:dist(?:-[^/]*)?|release(?:-[^/]*)?|staging|tmp)(\/|$)/.test(
            path.relative(process.cwd(), file).split(path.sep).join('/'),
          ),
      },
      fs: { allow: [process.cwd(), publicDirectory] },
    },
    build: {
      copyPublicDir: false,
      outDir: authoring ? 'dist-dev' : 'dist',
      rolldownOptions: {
        input: authoring
          ? {
              game: path.resolve('index.html'),
              sandbox: path.resolve('sandbox.html'),
              effects: path.resolve('effects.html'),
              editor: path.resolve('editor.html'),
            }
          : path.resolve('index.html'),
      },
    },
  };
}
export default defineConfig(async ({ command, mode }) => {
  const authoring = command === 'serve' || mode === 'sandbox';
  const workspace = await openWorkspace(
    command === 'serve' ? 'local' : 'pinned',
    authoring ? 'authoring' : 'runtime',
  );
  const config = webConfig(workspace.publicDirectory, authoring);
  config.plugins!.push({ name: 'lantern-workspace-lease', closeBundle: () => workspace.release() });
  return config;
});
