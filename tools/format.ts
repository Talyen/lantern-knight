import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProcess } from './run-process';
import { AssetCache, diskBytes } from './assets/cache';
import { projectRoot } from './assets/paths';
import { checkCommandScripts } from './task-runner';
async function quietRun(command: string, args: string[], timeoutMs = 120000) {
  let log = '';
  try {
    await runProcess(command, args, {
      cwd: projectRoot,
      timeoutMs,
      output: (chunk) => {
        log = (log + chunk.toString()).slice(-12000);
      },
    });
  } catch (error) {
    console.error(log);
    throw error;
  }
}
const RUFF_VERSION = '0.16.10';
export async function formatCode(check: boolean) {
  const names = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: projectRoot, encoding: 'utf8' },
  ).split('\0');
  const files = [];
  for (const name of [...new Set(names)]
    .filter(
      (n) =>
        !/^(?:references|public|staging|dist[^/]*|release[^/]*|node_modules)\//.test(n) &&
        /\.(?:[cm]?[jt]sx?|css|html|py)$/.test(n),
    )
    .sort()) {
    if (
      await fs.stat(path.join(projectRoot, name)).then(
        (s) => s.isFile(),
        (e) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        },
      )
    )
      files.push(name);
  }
  const python = files.filter((n) => n.endsWith('.py')),
    web = files.filter((n) => !n.endsWith('.py'));
  await quietRun(process.execPath, [
    'node_modules/prettier/bin/prettier.cjs',
    check ? '--check' : '--write',
    ...web,
  ]);
  const cache = new AssetCache(),
    held = await cache.lease('format-tools-ruff-' + RUFF_VERSION, 64 * 1024 ** 2);
  try {
    const executable = path.join(
      held.root,
      'runtime',
      'bin',
      process.platform === 'win32' ? 'ruff.exe' : 'ruff',
    );
    if (
      !(await fs.access(executable).then(
        () => true,
        () => false,
      ))
    ) {
      console.log('Installing pinned Ruff formatter ' + RUFF_VERSION + '…');
      await quietRun('python3', [
        '-m',
        'pip',
        'install',
        '--target',
        path.join(held.root, 'runtime'),
        '--no-compile',
        '--no-cache-dir',
        '--no-deps',
        'ruff==' + RUFF_VERSION,
      ]);
    }
    let version = '';
    await runProcess(executable, ['--version'], {
      cwd: projectRoot,
      output: (chunk) => {
        version += chunk.toString();
      },
    });
    if (version.trim() !== 'ruff ' + RUFF_VERSION)
      throw new Error('Unexpected Ruff version; remove the disposable formatter entry and retry');
    if (python.length)
      await quietRun(executable, ['format', ...(check ? ['--check'] : []), ...python]);
    if ((await diskBytes(held.root)) > 64 * 1024 ** 2)
      throw new Error('Formatter runtime exceeds its cache reservation');
  } finally {
    await held.release();
  }
  await checkCommandScripts(
    JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')).scripts,
  );
  console.log(
    `PASS: ${files.length} handwritten files ${check ? 'formatted consistently' : 'formatted'}.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--check')) throw new Error('Use format [--check]');
  formatCode(args.includes('--check')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
