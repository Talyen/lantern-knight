import { defineConfig, type UserConfig } from 'vite';
import path from 'node:path';
import type { BuildProfile } from './tools/build-profile';
import { openWorkspace } from './tools/assets/workspace';
export function webConfig(publicDirectory: string, profile: BuildProfile): UserConfig {
  const authoring = profile === 'authoring';
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
// Importing configuration for source analysis acquires no artwork or leases.
let directWorkspace: Awaited<ReturnType<typeof openWorkspace>> | undefined;
export default defineConfig({
  plugins: [
    ...webConfig('', 'authoring').plugins!,
    {
      name: 'lantern-direct-workspace',
      async config(_config, { command, mode }) {
        const authoring = command === 'serve' || mode === 'sandbox';
        directWorkspace = await openWorkspace(
          command === 'serve' ? 'local' : 'pinned',
          authoring ? 'authoring' : 'runtime',
        );
        const { plugins: _plugins, ...config } = webConfig(
          directWorkspace.publicDirectory,
          authoring ? 'authoring' : 'game',
        );
        return config;
      },
      closeBundle: () => directWorkspace?.release(),
    },
  ],
});
