import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { openWorkspace } from './assets/workspace';
import { projectRoot } from './assets/paths';
import { webConfig } from '../vite.config';

export async function developmentServer(
  options: { port?: number; pinned?: boolean; open?: boolean; runtime?: boolean } = {},
) {
  const workspace = await openWorkspace(
    options.pinned ? 'pinned' : 'local',
    options.runtime ? 'runtime' : 'authoring',
  );
  try {
    const identity = {
      root: await fs.realpath(projectRoot),
      assets: workspace.identity,
      target: 'development',
    };
    const config = webConfig(workspace.publicDirectory, true);
    const server = await createServer({
      ...config,
      configFile: false,
      root: projectRoot,
      mode: 'sandbox',
      publicDir: workspace.publicDirectory,
      server: {
        ...config.server,
        host: '127.0.0.1',
        port: options.port ?? Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
        strictPort: true,
        open: options.open ?? false,
        fs: { allow: [projectRoot, workspace.publicDirectory] },
      },
      plugins: [
        ...config.plugins!,
        {
          name: 'lantern-development-identity',
          configureServer(server) {
            server.middlewares.use('/__lantern_identity', (_req, res) => {
              res.setHeader('content-type', 'application/json');
              res.setHeader('cache-control', 'no-store');
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
    let closed = false;
    return {
      server,
      workspace,
      origin: server.resolvedUrls!.local[0]!.replace(/\/$/, ''),
      async close() {
        if (closed) return;
        closed = true;
        try {
          await server.close();
        } finally {
          await workspace.release();
        }
      },
    };
  } catch (error) {
    await workspace.release();
    throw error;
  }
}
export async function untilInterrupted() {
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      pinned: { type: 'boolean' },
      open: { type: 'boolean' },
      runtime: { type: 'boolean' },
    },
  });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error('Invalid development port');
  const session = await developmentServer({
    port,
    pinned: values.pinned,
    open: values.open,
    runtime: values.runtime,
  });
  try {
    session.server.printUrls();
    console.log(
      'Game /index.html · Sandbox /sandbox.html · Editor /editor.html · Effects /effects.html',
    );
    await untilInterrupted();
  } finally {
    await session.close();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
