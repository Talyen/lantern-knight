import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright';
import { AssetCache } from '../assets/cache';
import { cacheRoot, projectRoot } from '../assets/paths';
import { scenePreviewServer } from './scene-server';
import { withoutCommandLane } from '../command-lane';
import { shaFile } from '../assets/sources';
import { sandboxContent } from '../../src/content/sandbox-world';
import type {} from '../../src/inspection';

type Endpoint = { root: string; asset: string; tool: string; port: number; token: string };
async function browserToolIdentity() {
  const hashes = await Promise.all(
    [
      'tools/scene/prototype-browser.ts',
      'tools/scene/scene-server.ts',
      'tools/scene/scene-browser.cjs',
      'vite.config.ts',
    ].map((file) => shaFile(path.join(projectRoot, file))),
  );
  return createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}
const entryName =
  'prototype-browser-' + createHash('sha256').update(projectRoot).digest('hex').slice(0, 20);
async function endpoint(directory: string) {
  try {
    return JSON.parse(await fs.readFile(path.join(directory, 'endpoint.json'), 'utf8')) as Endpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
      return undefined;
    throw error;
  }
}
async function request(value: Endpoint, command: unknown, timeout = 15000) {
  const response = await fetch(`http://127.0.0.1:${value.port}/probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-prototype-token': value.token },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(timeout),
  });
  const result = (await response.json()) as { error?: string; elapsedMs?: number; scope?: string };
  if (!response.ok || result.error)
    throw new Error(result.error ?? 'Prototype browser request failed');
  return result;
}
export async function prototypeProbe(scene: string, loading = false) {
  if (!loading) sandboxContent.area(scene);
  const held = await new AssetCache().lease(entryName, 32 * 1024 ** 2);
  try {
    let server = await endpoint(held.root);
    if (server) {
      try {
        await request(server, { health: true }, 1000);
      } catch {
        server = undefined;
      }
    }
    if (
      server &&
      (server.root !== projectRoot ||
        server.asset !== process.env.LANTERN_ASSET_SHA256 ||
        server.tool !== (await browserToolIdentity()))
    ) {
      await request(server, { stop: true });
      server = undefined;
    }
    if (!server) {
      const log = await fs.open(path.join(held.root, 'browser.log'), 'w');
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          path.join(projectRoot, 'tools/scene/prototype-browser.ts'),
          '--serve',
          held.root,
        ],
        {
          cwd: projectRoot,
          detached: true,
          env: withoutCommandLane(process.env),
          stdio: ['ignore', log.fd, log.fd],
        },
      );
      child.unref();
      await log.close();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const candidate = await endpoint(held.root);
        if (
          candidate &&
          candidate.asset === process.env.LANTERN_ASSET_SHA256 &&
          candidate.tool === (await browserToolIdentity())
        ) {
          try {
            await request(candidate, { health: true }, 500);
            server = candidate;
            break;
          } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!server) {
        if (child.pid) process.kill(child.pid, 'SIGTERM');
        throw new Error(
          'Prototype browser startup failed: ' +
            (await fs.readFile(path.join(held.root, 'browser.log'), 'utf8')).slice(-2000),
        );
      }
    }
    return await request(server, { scene, loading });
  } finally {
    await held.release();
  }
}
export async function stopPrototypeBrowser() {
  const held = await new AssetCache().lease(entryName);
  try {
    const value = await endpoint(held.root);
    if (value) await request(value, { stop: true });
  } finally {
    await held.release();
  }
}
async function serve(directory: string) {
  const cache = new AssetCache();
  const assetEntry = path
    .relative(path.join(cacheRoot(), 'entries'), process.env.LANTERN_ASSET_WORKSPACE!)
    .split(path.sep)[0]!;
  if (!assetEntry || assetEntry.startsWith('.') || assetEntry.includes('/'))
    throw new Error('Invalid prototype asset workspace');
  const held = await cache.lease(entryName, 32 * 1024 ** 2),
    assets = await cache.lease(assetEntry);
  const preview = await scenePreviewServer();
  const browser = await _electron.launch({
    args: [
      path.join(projectRoot, 'tools/scene/scene-browser.cjs'),
      preview.origin + '/__lantern_prototype_blank',
      path.join(directory, 'profile'),
    ],
    timeout: 8000,
  });
  const page = await browser.firstWindow();
  await page.evaluate(() => Reflect.set(window, '__name', (fn: Function) => fn));
  const fixture = page;
  const token = randomUUID();
  let last = Date.now(),
    chain = Promise.resolve();
  const close = async () => {
    clearInterval(idle);
    await fs.rm(path.join(directory, 'endpoint.json'), { force: true });
    await browser.close();
    await preview.close();
    await assets.release();
    await held.release();
    server.close();
  };
  const server = createServer((req, res) => {
    if (
      req.method !== 'POST' ||
      req.url !== '/probe' ||
      req.headers['x-prototype-token'] !== token
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      chain = chain
        .then(async () => {
          const started = performance.now();
          last = Date.now();
          try {
            const command = JSON.parse(body) as {
              health?: boolean;
              stop?: boolean;
              scene?: string;
              loading?: boolean;
            };
            if (!command.health && !command.stop) {
              if (command.loading) {
                await fixture.goto(preview.origin + '/__lantern_prototype_blank');
                await fixture.setContent(
                  '<link rel="stylesheet" href="/src/loading-screen.css"><dialog id="loading-screen" open><video muted loop playsinline></video><p>Loading</p></dialog><canvas tabindex="0"></canvas>',
                );
                await fixture.evaluate(`async () => {
                const {LoadingScreen} = await import('/src/loading-screen.ts');
                const screen = new LoadingScreen();
                const video = document.querySelector('video');
                await new Promise((resolve, reject) => { if (video.readyState >= 2) return resolve(); video.addEventListener('loadeddata', resolve, {once:true}); video.addEventListener('error', reject, {once:true}); });
                if (!video.muted || !video.loop || !document.querySelector('dialog').open) throw new Error('Loading video policy failed');
                screen.set(false);
                if (document.querySelector('dialog').open || !video.paused) throw new Error('Loading did not dismiss');
                screen.dispose();
              }`);
              } else {
                sandboxContent.area(command.scene!);
                if (!page.url().includes('/sandbox.html'))
                  await page.goto(preview.origin + '/sandbox.html');
                await page.waitForFunction(() => window.foundation?.ready, {}, { timeout: 10000 });
                await page.evaluate(async (scene) => {
                  await window.foundation.fixture(scene);
                  window.foundation.pause(true);
                  if (window.foundation.sim.area !== scene) throw new Error('Wrong scene');
                  window.foundation.presentation.update(window.foundation.sim, 1, 0, {
                    x: 0,
                    z: 1,
                  });
                  const canvas = document.querySelector('canvas')!;
                  if (
                    !canvas.width ||
                    !canvas.height ||
                    !window.foundation.presentation.lookRenderer.ready
                  )
                    throw new Error('Renderer is not ready');
                  if (document.querySelector<HTMLDialogElement>('#loading-screen')?.open)
                    throw new Error('Scene load did not release the overlay');
                }, command.scene!);
              }
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                elapsedMs: Math.round(performance.now() - started),
                scope:
                  'targeted production component; exhaustive renderer/platform/delivery coverage deferred',
              }),
            );
            if (command.stop) await close();
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: String(error) }));
          }
        })
        .catch((error) => console.error(error));
    });
  });
  const idle = setInterval(() => {
    if (Date.now() - last > 10 * 60_000) close().catch((error) => console.error(error));
  }, 30000);
  const tool = await browserToolIdentity();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Prototype browser listener unavailable');
    fs.writeFile(
      path.join(directory, 'endpoint.json'),
      JSON.stringify({
        root: projectRoot,
        asset: process.env.LANTERN_ASSET_SHA256,
        tool,
        port: address.port,
        token,
      }),
    ).catch((error) => console.error(error));
  });
}
if (process.argv[2] === '--serve')
  serve(process.argv[3]!).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
