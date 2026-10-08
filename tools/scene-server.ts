import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { projectRoot } from './assets/paths';

const origin = 'http://127.0.0.1:5174',
  endpoint = '/__lantern_scene_preview';
export async function scenePreviewServer() {
  const identity = {
    root: await fs.realpath(projectRoot),
    assets: process.env.LANTERN_ASSET_SHA256,
    recipe: process.env.LANTERN_ASSET_RECIPE_SHA256,
    workspace: process.env.LANTERN_ASSET_WORKSPACE,
  };
  let response: Response | undefined;
  try {
    response = await fetch(origin + endpoint, { signal: AbortSignal.timeout(1000) });
  } catch {}
  if (response) {
    const actual = await response.json().catch(() => null);
    if (!response.ok || JSON.stringify(actual) !== JSON.stringify(identity))
      throw new Error(
        'Port 5174 belongs to another preview or asset revision. Stop that server before starting this preview.',
      );
    return { origin, reused: true, async close() {} };
  }
  const server = await createServer({
    mode: 'sandbox',
    server: { host: '127.0.0.1', port: 5174, strictPort: true, open: false },
    plugins: [
      {
        name: 'lantern-scene-preview',
        configureServer(server) {
          server.middlewares.use(endpoint, (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(identity));
          });
        },
      },
    ],
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  return { origin, reused: false, close: () => server.close() };
}
