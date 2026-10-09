import { runProcess } from '../run-process';
import { withoutCommandLane } from '../command-lane';
import { projectRoot } from '../assets/paths';
import type { Invocation } from '../task-context';
export async function develop({ context, clean, env, output, definition }: Invocation) {
  if (definition.admission === 'startup') await context.releaseAdmission();
  await runProcess(
    process.execPath,
    ['--import', 'tsx', definition.file!, ...(definition.prefix ?? []), ...clean],
    { cwd: projectRoot, env: withoutCommandLane(env), output },
  );
}

import path from 'node:path';
import { execFile } from 'node:child_process';
import { _electron } from 'playwright';
import { AssetCache } from '../assets/cache';
import { scenePreviewServer } from './scene-server';

async function previewSession(env: NodeJS.ProcessEnv) {
  const cache = new AssetCache();
  const workspace = env.LANTERN_ASSET_WORKSPACE;
  if (!workspace) throw new Error('Preview requires a verified asset workspace');
  const entry = path.relative(path.join(cache.root, 'entries'), workspace).split(path.sep)[0]!;
  if (!entry || entry.startsWith('.') || path.isAbsolute(entry))
    throw new Error('Invalid preview asset workspace');
  const assets = await cache.lease(entry);
  try {
    const server = await scenePreviewServer(projectRoot, env);
    let closed = false;
    return {
      ...server,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await server.close();
        } finally {
          await assets.release();
        }
      },
    };
  } catch (error) {
    await assets.release();
    throw error;
  }
}

export async function previewBrowser(
  profile: string,
  pagePath: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const server = await previewSession(env);
  try {
    const browser = await _electron.launch({
      args: [
        path.join(projectRoot, 'tools/scene/scene-browser.cjs'),
        server.origin + pagePath,
        profile,
      ],
      timeout: 8000,
    });
    try {
      const page = await browser.firstWindow();
      await page.evaluate(() => Reflect.set(window, '__name', (fn: Function) => fn));
      let closed = false;
      return {
        origin: server.origin,
        reused: server.reused,
        browser,
        page,
        async close() {
          if (closed) return;
          closed = true;
          try {
            await browser.close();
          } finally {
            await server.close();
          }
        },
      };
    } catch (error) {
      await browser.close();
      throw error;
    }
  } catch (error) {
    await server.close();
    throw error;
  }
}
export async function openPreview(pagePath: string, env: NodeJS.ProcessEnv = process.env) {
  const server = await previewSession(env);
  try {
    const url = server.origin + pagePath;
    console.log(`${server.reused ? 'Reusing' : 'Serving'} scene preview: ${url}`);
    execFile(
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer'
          : 'xdg-open',
      [url],
      (error) => {
        if (error) console.log('Open the preview URL in your browser.');
      },
    );
    if (server.reused) return;
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        resolve();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  } finally {
    await server.close();
  }
}
