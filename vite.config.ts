import { defineConfig } from 'vite';
import path from 'node:path';
import { sceneEditorPlugin } from './tools/scene-editor-store';
import { publicRoot } from './tools/assets/paths.ts';
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  plugins: mode === 'sandbox' ? [sceneEditorPlugin(process.cwd())] : [],
  publicDir: publicRoot(),
  server: {
    watch: {
      ignored: (file: string) =>
        /^(?:dist(?:-[^/]*)?|release(?:-[^/]*)?|staging|tmp)(\/|$)/.test(
          path.relative(process.cwd(), file).split(path.sep).join('/'),
        ),
    },
    fs: { allow: [process.cwd(), publicRoot()] },
  },
  build: {
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
