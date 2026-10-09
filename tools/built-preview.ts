import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { buildIdentity } from './build-identity';
import { projectRoot } from './assets/paths';
import { untilInterrupted } from './dev';

async function builtPreview(port = Number(process.env.LANTERN_PREVIEW_PORT ?? 5174)) {
  const artifact = await buildIdentity({ target: 'web' });
  const identity = {
    root: await fs.realpath(projectRoot),
    assets: artifact.assets.sha256,
    target: 'built',
  };
  return preview({
    configFile: false,
    root: projectRoot,
    publicDir: false,
    build: { outDir: 'dist' },
    preview: { host: '127.0.0.1', port, strictPort: true },
    plugins: [
      {
        name: 'lantern-built-identity',
        configurePreviewServer(server) {
          server.middlewares.use('/__lantern_identity', (_req, res) => {
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify(identity));
          });
        },
      },
    ],
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await builtPreview();
  try {
    server.printUrls();
    await untilInterrupted();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
