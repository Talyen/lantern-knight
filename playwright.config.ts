import { defineConfig } from '@playwright/test';
import path from 'node:path';
const desktop = process.env.LANTERN_TEST_TARGET === 'desktop';
const built = process.env.LANTERN_TEST_BUILT === 'true';
const port = process.env.LANTERN_PREVIEW_PORT ?? '5174';
export default defineConfig({
  testDir: desktop ? 'tests/desktop' : 'tests/browser',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  outputDir: '.cache/browser-results',
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: desktop
    ? undefined
    : {
        command: built
          ? 'node --import tsx tools/built-preview.ts'
          : `npm run dev -- --port ${port}${process.env.LANTERN_TEST_ASSETS === 'pinned' ? ' --pinned' : ''}${process.env.LANTERN_TEST_SCOPE === 'runtime' ? ' --runtime' : ''}`,
        url: `http://127.0.0.1:${port}/__lantern_identity`,
        reuseExistingServer: !built && !process.env.CI,
        timeout: 60_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      },
  metadata: { checkout: path.resolve('.') },
});
