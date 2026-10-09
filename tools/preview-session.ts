import fs from 'node:fs/promises';
import { createServer, preview } from 'vite';
import { openWorkspace, type AssetWorkspace } from './assets/workspace';
import type { AssetScope } from './assets/bundles';
import { projectRoot } from './assets/paths';
import { webConfig } from '../vite.config';
import { verifyBuildIdentity } from './build-identity';
export type PreviewOptions = {
  output: 'development' | 'built';
  assets: 'local' | 'pinned';
  scope: AssetScope;
  port: number;
  reuse?: boolean;
  open?: boolean;
};
export async function openPreview(options: PreviewOptions) {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
    throw new Error('Invalid preview port');
  const origin = `http://127.0.0.1:${options.port}`;
  const artifact =
    options.output === 'built' ? await verifyBuildIdentity({ target: 'web' }) : undefined;
  const workspace = artifact ? undefined : await openWorkspace(options.assets, options.scope);
  let owned: { close(): Promise<void> } | undefined;
  try {
    let existing: Response | undefined;
    try {
      existing = await fetch(origin + '/__lantern_identity', { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError')
        throw new Error('Preview port is occupied by an unresponsive server');
    }
    if (existing) {
      if (!options.reuse) throw new Error('Preview port is already occupied');
      const identity = await existing.json();
      if (
        identity.root !== (await fs.realpath(projectRoot)) ||
        identity.assets !== workspace?.identity ||
        identity.target !== 'development' ||
        (options.scope === 'authoring' && identity.scope !== 'authoring')
      )
        throw new Error('Preview belongs to another checkout or asset identity');
    } else if (workspace) {
      owned = await developmentServer(workspace, { port: options.port, open: options.open });
    } else {
      const identity = {
        root: await fs.realpath(projectRoot),
        assets: artifact!.assets.sha256,
        target: 'built',
      };
      const server = await preview({
        configFile: false,
        root: projectRoot,
        publicDir: false,
        build: { outDir: 'dist' },
        preview: { host: '127.0.0.1', port: options.port, strictPort: true },
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
      owned = {
        close: () =>
          new Promise<void>((resolve, reject) =>
            server.httpServer.close((error) => (error ? reject(error) : resolve())),
          ),
      };
    }
    let closed = false;
    return {
      origin,
      workspace,
      assetIdentity: workspace?.identity ?? artifact!.assets.sha256,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await owned?.close();
        } finally {
          await workspace?.release();
        }
      },
    };
  } catch (error) {
    await workspace?.release();
    throw error;
  }
}
async function developmentServer(
  workspace: AssetWorkspace,
  options: { port: number; open?: boolean },
) {
  const identity = {
    root: await fs.realpath(projectRoot),
    assets: workspace.identity,
    target: 'development',
    scope: workspace.scope,
  };
  const config = webConfig(workspace.publicDirectory, 'authoring');
  const server = await createServer({
    ...config,
    configFile: false,
    root: projectRoot,
    mode: 'sandbox',
    publicDir: workspace.publicDirectory,
    server: {
      ...config.server,
      host: '127.0.0.1',
      port: options.port,
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
      await server.close();
    },
  };
}
