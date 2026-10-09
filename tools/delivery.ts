import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from './assets/paths';
import { runProcess } from './run-process';
import { taskBudget } from './task-budget';
import { guardedBuild, verificationIdentity, requireStableInputs } from './verification';
import type { Invocation } from './task-runner';
export async function e2e({ run, args, clean, child }: Invocation) {
  if (!['darwin', 'win32'].includes(process.platform))
    throw new Error('E2E requires macOS or Windows');
  const before = await verificationIdentity(projectRoot);
  for (const task of ['build:verify', 'build:dev:verify']) await run(task, args);
  await child('tools/smoke/e2e.ts', clean, taskBudget('test:e2e'));
  await requireStableInputs(projectRoot, before);
}
export async function fullVerification({ context, run, args }: Invocation) {
  if (!['darwin', 'win32'].includes(process.platform))
    throw new Error('Full verification requires macOS or Windows');
  const before = await verificationIdentity(projectRoot),
    host = process.platform === 'darwin' ? 'mac' : 'win';
  context.env = { ...context.env, LANTERN_FULL_VERIFICATION: '1' };
  for (const task of [
    'check:full',
    'build',
    'build:dev',
    `package:${host}:prebuilt`,
    `package:dev:${host}:prebuilt`,
    'test:e2e',
  ]) {
    const started = performance.now();
    await run(task, task === 'test:e2e' ? [...args, '--full'] : args);
    console.log(`Verification phase ${task}: ${Math.round(performance.now() - started)}ms.`);
  }
  await requireStableInputs(projectRoot, before);
  console.log(
    'PASS: complete host verification; other platforms and visible playtesting require separate evidence.',
  );
}

export async function build({ clean, env, output, child, definition }: Invocation) {
  if (clean.length) throw new Error('Build accepts only --local');
  const dev = definition.dev ?? false,
    identity = path.join(projectRoot, dev ? 'dist-dev' : 'dist', 'build-identity.json');
  const execute = () =>
    guardedBuild(
      projectRoot,
      identity,
      async (before) => {
        await child('node_modules/typescript/bin/tsc', ['--noEmit']);
        await child('node_modules/vite/bin/vite.js', [
          'build',
          ...(dev ? ['--mode', 'sandbox'] : []),
        ]);
        await child('tools/select-runtime-assets.ts', dev ? ['--dev'] : []);
        await child('tools/build-electron.ts', dev ? ['--dev'] : []);
        await runProcess(
          process.execPath,
          ['--import', 'tsx', 'tools/build-identity.ts', ...(dev ? ['--dev'] : []), '--write'],
          {
            cwd: projectRoot,
            env: { ...env, LANTERN_BUILD_SOURCE: JSON.stringify(before) },
            output,
          },
        );
      },
      { scope: 'runtime' },
    );
  if (process.env.CI === 'true') return execute();
  const { phaseEvidence } = await import('./task-state');
  const { fileChecksums } = await import('./verified-files');
  const inputs = await verificationIdentity(projectRoot, { scope: 'runtime' });
  const key = [
    inputs.sha256,
    env.LANTERN_ASSET_SHA256,
    process.version,
    process.platform,
    dev,
    'build-v1',
  ].join(':');
  const result = await phaseEvidence(
    projectRoot,
    dev ? 'build:dev' : 'build',
    key,
    async () => {
      await execute();
      const data = JSON.parse(await fs.readFile(identity, 'utf8')) as {
        files: Record<string, string>;
      };
      return {
        signatures: await fileChecksums(projectRoot, [
          ...Object.keys(data.files),
          path.relative(projectRoot, identity),
        ]),
      };
    },
    async (proof) => {
      try {
        return (
          JSON.stringify(proof.signatures) ===
          JSON.stringify(await fileChecksums(projectRoot, Object.keys(proof.signatures)))
        );
      } catch {
        return false;
      }
    },
  );
  if (result.reused)
    console.log('Reused validated build: runtime inputs, pinned assets and output files match.');
}

export async function packageApp({ run, args, output, child, definition }: Invocation) {
  const { dev, host, prebuilt } = definition.package!;
  if (!host) throw new Error('Unknown package target');
  if (!prebuilt) await run(dev ? 'build:dev' : 'build', args, output);
  await child('tools/build-identity.ts', dev ? ['--dev'] : []);
  const execute = () =>
    child('node_modules/electron-builder/cli.js', [
      ...(dev ? ['--config', 'electron-builder.dev.json'] : []),
      '--' + host,
      host === 'mac' ? '--arm64' : '--x64',
      '--dir',
    ]);
  if (process.env.CI === 'true') return execute();
  const { phaseEvidence } = await import('./task-state');
  const { fileChecksums } = await import('./verified-files');
  const dist = dev ? 'dist-dev' : 'dist';
  const name = dev ? 'Lantern Knight Dev' : 'Lantern Knight';
  const release = dev ? 'release-dev' : 'release';
  const files =
    host === 'mac'
      ? [
          `${release}/mac-arm64/${name}.app/Contents/Resources/app.asar`,
          `${release}/mac-arm64/${name}.app/Contents/MacOS/${name}`,
        ]
      : [`${release}/win-unpacked/resources/app.asar`, `${release}/win-unpacked/${name}.exe`];
  const identity = await fs.readFile(path.join(projectRoot, dist, 'build-identity.json'), 'utf8');
  const config = await fs.readFile(
    path.join(projectRoot, dev ? 'electron-builder.dev.json' : 'package.json'),
    'utf8',
  );
  const key = identity + config + process.platform + host + 'package-v1';
  const proof = await phaseEvidence(
    projectRoot,
    'package:' + dev + ':' + host,
    key,
    async () => {
      await execute();
      return { signatures: await fileChecksums(projectRoot, files) };
    },
    async (value) => {
      try {
        return (
          JSON.stringify(value.signatures) ===
          JSON.stringify(await fileChecksums(projectRoot, files))
        );
      } catch {
        return false;
      }
    },
  );
  if (proof.reused) console.log('Reused matching validated package output.');
}
