import { emptyScene } from '../src/editor/default-scene';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { scenePreviewPort, scenePreviewServer } from '../tools/scene/scene-server';
import { verificationIdentity, requireStableInputs } from '../tools/verification';
import { parseTask } from '../tools/task-runner';

async function unusedPort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return port;
}

test('Chromium host accepts its assigned preview port and rejects other origins', async () => {
  const source = await fs.readFile(
    new URL('../tools/scene/scene-browser.cjs', import.meta.url),
    'utf8',
  );
  const launch = (url: string, port?: string) => {
    let profile: string | undefined;
    vm.runInNewContext(source, {
      URL,
      process: {
        argv: ['electron', 'scene-browser.cjs', url, 'isolated-profile'],
        env: { LANTERN_PREVIEW_PORT: port },
      },
      require: () => ({
        app: {
          setPath: (_name: string, value: string) => {
            profile = value;
          },
          enableSandbox() {},
          commandLine: { appendSwitch() {} },
          whenReady: () => new Promise<void>(() => {}),
          on() {},
        },
      }),
    });
    return profile;
  };
  assert.equal(launch('http://127.0.0.1:5174/editor.html'), 'isolated-profile');
  assert.equal(
    launch('http://127.0.0.1:5176/sandbox.html?scene=court', '5176'),
    'isolated-profile',
  );
  for (const url of [
    'http://127.0.0.1:5174/editor.html',
    'http://example.invalid:5176/editor.html',
    'http://user@127.0.0.1:5176/editor.html',
    'http://127.0.0.1:5176/index.html',
  ])
    assert.throws(() => launch(url, '5176'), /assigned local scene preview port/);
});

test('invalid preview ports fail managed preflight before startup', async () => {
  const previous = process.env.LANTERN_PREVIEW_PORT;
  try {
    delete process.env.LANTERN_PREVIEW_PORT;
    assert.equal(scenePreviewPort(), 5174);
    for (const value of ['', '0', '-1', '65536', '1.5', '5175x', ' 5175', '05175']) {
      process.env.LANTERN_PREVIEW_PORT = value;
      for (const [command, args] of [
        ['scene:editor', []],
        ['scene:editor:check', []],
        ['scene:dev', ['--scene', 'court']],
        ['scene:check', ['--scene', 'court']],
        ['scene:benchmark', ['--scene', 'court']],
        ['check:task', ['--scene', 'court']],
      ] as const)
        await assert.rejects(parseTask(command, [...args]), /LANTERN_PREVIEW_PORT/);
    }
    assert.equal(scenePreviewPort('1'), 1);
    assert.equal(scenePreviewPort('65535'), 65535);
  } finally {
    if (previous === undefined) delete process.env.LANTERN_PREVIEW_PORT;
    else process.env.LANTERN_PREVIEW_PORT = previous;
  }
});

test('worktree previews isolate editor writes and verification, then integrate gameplay and scene edits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-worktrees-')),
    root = path.join(directory, 'integration'),
    gameplay = path.join(directory, 'gameplay'),
    scene = path.join(directory, 'scene');
  const git = (cwd: string, args: string[], input?: string) =>
    execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const previews: Awaited<ReturnType<typeof scenePreviewServer>>[] = [];
  let foreign: http.Server | undefined, occupied: net.Server | undefined;
  try {
    const files: Record<string, string> = {
      '.gitignore': 'node_modules/\n',
      'package.json': '{"type":"module"}',
      'src/core/gameplay.ts': 'export const damage = 1;\n',
      'src/content/world-art.ts':
        'export const baseWorldVisuals = {}; export const resolveAuthoredScene = () => ({});\n',
      'vite.config.mjs':
        `import { sceneEditorPlugin } from ${JSON.stringify(new URL('../tools/scene/scene-editor-store.ts', import.meta.url).href)};\n` +
        'export default { publicDir: false, logLevel: "silent", plugins: [sceneEditorPlugin(import.meta.dirname)] };\n',
    };
    // Minimal foundations for the real editor's optimistic save guard; no artwork is read.
    for (const file of [
      'src/content/graveyard-scene.ts',
      'src/content/crypt-scene.ts',
      'src/content/graveyard-layout.ts',
      'src/content/world.ts',
      'src/content/game-content.ts',
      'src/content/scenery-presets.ts',
      'src/content/scene-v1.ts',
      'src/content/scene-v1-baseline.json',
      'src/content/scene-document.ts',
      'src/content/scene-design.ts',
      'src/assets/camera.json',
      'src/content/camera.json',
      'assets/lock.json',
    ])
      files[file] = file.endsWith('.json') ? '{}\n' : 'export {};\n';
    const document = { ...emptyScene('court'), id: 'draft-court', objects: [] };
    files['authoring/scenes/draft-court.json'] = JSON.stringify(document, null, 2) + '\n';
    for (const [file, bytes] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), bytes);
    }
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'Worktree fixture']);
    git(root, ['config', 'user.email', 'fixture@example.invalid']);
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', 'Shared fixture baseline']);
    for (const checkout of [gameplay, scene])
      git(root, ['worktree', 'add', '--quiet', '--detach', checkout]);

    const portA = await unusedPort();
    let portB = await unusedPort();
    while (portB === portA) portB = await unusedPort();
    const env = (port: number) => ({
      ...process.env,
      LANTERN_PREVIEW_PORT: String(port),
      LANTERN_ASSET_SHA256: 'fixture-pack',
      LANTERN_ASSET_RECIPE_SHA256: 'fixture-recipe',
      LANTERN_ASSET_WORKSPACE: 'shared-immutable-fixture',
    });
    for (const [checkout, port] of [
      [gameplay, portA],
      [scene, portB],
    ] as const)
      previews.push(await scenePreviewServer(checkout, env(port)));
    const [a, b] = previews as [(typeof previews)[number], (typeof previews)[number]];
    const reused = await scenePreviewServer(gameplay, env(portA));
    assert.equal(reused.reused, true);
    await reused.close();
    assert.equal((await fetch(a.origin + '/__lantern_scene_preview')).status, 200);
    await assert.rejects(scenePreviewServer(scene, env(portA)), /another checkout/);
    await assert.rejects(
      scenePreviewServer(gameplay, { ...env(portA), LANTERN_ASSET_SHA256: 'different-pack' }),
      /asset revision/,
    );

    const editor = async (origin: string, id = '') => {
      const response = await fetch(origin + '/__lantern_editor' + (id ? '?id=' + id : ''));
      assert.equal(response.status, 200);
      return response.json();
    };
    const listA = await editor(a.origin),
      listB = await editor(b.origin);
    assert.notEqual(listA.workspace, listB.workspace);
    const currentB = await editor(b.origin, document.id);
    const save = (token: string, origin: string) =>
      fetch(b.origin + '/__lantern_editor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lantern-editor-token': token,
          Origin: origin,
        },
        body: JSON.stringify({ ...currentB, document: { ...document, name: 'Scene task' } }),
      });
    assert.equal((await save(listA.token, a.origin)).status, 403);
    assert.equal((await save(listA.token, b.origin)).status, 403);
    const beforeA = await verificationIdentity(gameplay),
      beforeB = await verificationIdentity(scene);
    const response = await save(listB.token, b.origin);
    assert.equal(response.status, 200, await response.text());
    await requireStableInputs(gameplay, beforeA);
    await assert.rejects(requireStableInputs(scene, beforeB), /Source inputs changed/);
    assert.equal((await editor(a.origin, document.id)).document.name, document.name);

    await fs.writeFile(path.join(gameplay, 'src/core/gameplay.ts'), 'export const damage = 2;\n');
    await assert.rejects(requireStableInputs(gameplay, beforeA), /Source inputs changed/);
    assert.equal(
      await fs.readFile(path.join(scene, 'src/core/gameplay.ts'), 'utf8'),
      files['src/core/gameplay.ts'],
    );
    for (const checkout of [gameplay, scene])
      git(root, ['apply', '-'], git(checkout, ['diff', '--binary', 'HEAD']));
    const integrated = await verificationIdentity(root);
    assert.equal(
      await fs.readFile(path.join(root, 'src/core/gameplay.ts'), 'utf8'),
      'export const damage = 2;\n',
    );
    assert.equal(
      JSON.parse(await fs.readFile(path.join(root, 'authoring/scenes/draft-court.json'), 'utf8'))
        .name,
      'Scene task',
    );
    await requireStableInputs(root, integrated);

    await a.close();
    assert.equal((await editor(b.origin, document.id)).document.name, 'Scene task');
    const current = await editor(b.origin, document.id),
      sceneFile = path.join(scene, 'authoring/scenes/draft-court.json'),
      sceneBytes = await fs.readFile(sceneFile, 'utf8');
    await fs.writeFile(
      path.join(scene, 'src/content/scene-design.ts'),
      'export const paletteChanged = true;\n',
    );
    const stale = await fetch(b.origin + '/__lantern_editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lantern-editor-token': listB.token },
      body: JSON.stringify({
        ...current,
        document: { ...current.document, name: 'Unreviewed registry' },
      }),
    });
    assert.equal(stale.status, 409, await stale.text());
    assert.equal(await fs.readFile(sceneFile, 'utf8'), sceneBytes);
    foreign = http.createServer((_request, result) => result.end('unrelated server'));
    await new Promise<void>((resolve) => foreign!.listen(0, '127.0.0.1', resolve));
    const foreignPort = (foreign.address() as net.AddressInfo).port;
    await assert.rejects(scenePreviewServer(gameplay, env(foreignPort)), /another checkout/);
    assert.equal(await (await fetch(`http://127.0.0.1:${foreignPort}`)).text(), 'unrelated server');
    occupied = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => occupied!.listen(0, '127.0.0.1', resolve));
    const occupiedPort = (occupied.address() as net.AddressInfo).port;
    await assert.rejects(scenePreviewServer(gameplay, env(occupiedPort)), /port .* is occupied/);
    assert.equal(occupied.listening, true);
  } finally {
    await Promise.all(previews.map((preview) => preview.close()));
    if (foreign) await new Promise<void>((resolve) => foreign!.close(() => resolve()));
    if (occupied) await new Promise<void>((resolve) => occupied!.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
