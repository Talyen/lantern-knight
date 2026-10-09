import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { projectRoot } from '../assets/paths';

const endpoint = '/__lantern_scene_preview';
export function scenePreviewPort(value = process.env.LANTERN_PREVIEW_PORT) {
  if (value === undefined) return 5174;
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535)
    throw new Error('LANTERN_PREVIEW_PORT must be an integer from 1 to 65535.');
  return Number(value);
}
export async function scenePreviewServer(root = projectRoot, env = process.env) {
  const port = scenePreviewPort(env.LANTERN_PREVIEW_PORT),
    origin = `http://127.0.0.1:${port}`;
  const identity = {
    root: await fs.realpath(root),
    assets: env.LANTERN_ASSET_SHA256,
    recipe: env.LANTERN_ASSET_RECIPE_SHA256,
    workspace: env.LANTERN_ASSET_WORKSPACE,
  };
  let response: Response | undefined;
  try {
    response = await fetch(origin + endpoint, { signal: AbortSignal.timeout(1000) });
  } catch {}
  if (response) {
    const actual = await response.json().catch(() => null);
    if (!response.ok || JSON.stringify(actual) !== JSON.stringify(identity))
      throw new Error(
        `Preview port ${port} belongs to another checkout, asset revision or server. Use a different LANTERN_PREVIEW_PORT or stop your own preview.`,
      );
    return { origin, reused: true, async close() {} };
  }
  const server = await createServer({
    root,
    mode: 'sandbox',
    server: { host: '127.0.0.1', port, strictPort: true, open: false },
    plugins: [
      {
        name: 'lantern-scene-preview',
        configureServer(server) {
          server.middlewares.use('/__lantern_prototype_blank', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><html><body></body></html>');
          });
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
    if (
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ||
      /already in use/.test(String(error))
    )
      throw new Error(`Preview port ${port} is occupied. Use a different LANTERN_PREVIEW_PORT.`);
    throw error;
  }
  return { origin, reused: false, close: () => server.close() };
}
