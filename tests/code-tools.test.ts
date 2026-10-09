import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { codeFiles, withRuff } from '../tools/code-tools';
import { commands } from '../tools/task-runner';
import { projectRoot } from '../tools/assets/paths';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern code tools '));
  const write = async (file: string, data: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), data);
  };
  const run = (tool: string, args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [path.join(projectRoot, 'node_modules', tool), ...args],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, LANTERN_ASSET_WORKSPACE: '/unavailable-artwork' },
      },
    );
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { root, write, run, close: () => fs.rm(root, { recursive: true, force: true }) };
}

test('code discovery includes prospective inputs, excludes generated data and works without Git', async () => {
  const f = await fixture();
  try {
    await f.write('src/main.ts', 'export {};');
    await f.write('tools/check.py', 'pass');
    await f.write('vite.config.ts', 'export {};');
    await f.write('public/generated/bad.ts', 'invalid');
    await f.write('references/canon/bad.ts', 'invalid');
    await f.write('node_modules/bad.ts', 'invalid');
    await f.write('tools/node_modules/bad.ts', 'invalid');
    assert.deepEqual(await codeFiles(f.root), ['src/main.ts', 'tools/check.py', 'vite.config.ts']);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
    git('init', '--quiet');
    git('add', 'src/main.ts');
    await fs.unlink(path.join(f.root, 'src/main.ts'));
    await f.write('.gitignore', 'tools/ignored.py\n');
    await f.write('tools/ignored.py', 'invalid');
    await f.write('tests/new.test.ts', 'export {};');
    assert.deepEqual(await codeFiles(f.root), [
      'tests/new.test.ts',
      'tools/check.py',
      'vite.config.ts',
    ]);
    if (process.platform !== 'win32') {
      await fs.symlink(path.join(f.root, 'vite.config.ts'), path.join(f.root, 'tools/link.ts'));
      await assert.rejects(codeFiles(f.root), /cannot follow symlink/);
    }
  } finally {
    await f.close();
  }
});

test('type-aware checks distinguish node:test registrations from floating operations', async () => {
  const f = await fixture();
  try {
    const config = JSON.parse(await fs.readFile(path.join(projectRoot, '.oxlintrc.json'), 'utf8'));
    await f.write('.oxlintrc.json', JSON.stringify(config));
    await f.write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          typeRoots: [path.join(projectRoot, 'node_modules/@types')],
          types: ['node'],
          noEmit: true,
        },
        include: ['tests'],
      }),
    );
    await f.write(
      'tests/check.test.ts',
      `import test from 'node:test';
async function work() { await Promise.resolve(); }
test('valid', async () => { await work(); });
function callback(_unused: number) {} callback(1);`,
    );
    const args = ['--config', '.oxlintrc.json', '--threads=2', '--deny-warnings', 'tests'];
    let result = f.run('oxlint/bin/oxlint', args);
    assert.equal(result.status, 0, result.output);
    await f.write(
      'tests/check.test.ts',
      `import test from 'node:test';
import fs from 'node:fs';
async function work() { await Promise.resolve(); }
test('invalid', () => { work(); void work(); });
[1].forEach(async () => { await work(); });`,
    );
    result = f.run('oxlint/bin/oxlint', args);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /no-floating-promises/);
    assert.match(result.output, /no-misused-promises/);
    assert.match(result.output, /no-unused-vars/);
    await f.write(
      'tests/check.test.ts',
      `export {}; async function test() { await Promise.resolve(); } test();`,
    );
    result = f.run('oxlint/bin/oxlint', args);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /no-floating-promises/);
  } finally {
    await f.close();
  }
});

test('Knip discovers orphan code and dependencies without treating every tool as an entrypoint', async () => {
  const f = await fixture();
  try {
    await f.write(
      'package.json',
      JSON.stringify({
        private: true,
        type: 'module',
        devDependencies: { 'unused-fixture': '1.0.0' },
      }),
    );
    await f.write(
      'knip.json',
      JSON.stringify({
        entry: ['src/main.ts'],
        project: ['src/**/*.ts'],
        includeEntryExports: true,
        include: ['files', 'exports', 'dependencies'],
      }),
    );
    await f.write('src/main.ts', `export const unused = 1;`);
    await f.write('src/orphan.ts', 'export {};');
    let result = f.run('knip/bin/knip.js', ['--no-progress', '--reporter', 'compact']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /src\/orphan.ts/);
    assert.match(result.output, /unused-fixture/);
    assert.match(result.output, /unused/);
    await f.write('package.json', '{"private":true,"type":"module"}');
    await f.write('src/main.ts', 'console.log(1);');
    await fs.unlink(path.join(f.root, 'src/orphan.ts'));
    result = f.run('knip/bin/knip.js', ['--no-progress', '--reporter', 'compact']);
    assert.equal(result.status, 0, result.output);
    const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'knip.json'), 'utf8'));
    for (const command of Object.values(commands))
      if (command.file?.startsWith('tools/') && /\.[cm]?[jt]s$/.test(command.file))
        assert.ok(config.entry.includes(command.file), command.file);
    const recipe = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'assets/recipe.json'), 'utf8'),
    );
    for (const step of recipe.steps)
      if (step.file.endsWith('.ts'))
        assert.ok(config.entry.includes('tools/' + step.file), step.file);
    for (const entry of [
      'src/main.ts',
      'src/sandbox.ts',
      'src/editor.ts',
      'src/effects-playground.ts',
      'electron/main.ts',
      'electron/preload.ts',
      'tests/*.test.ts',
    ])
      assert.ok(config.entry.includes(entry));
  } finally {
    await f.close();
  }
});

test('Ruff rejects undefined names and mutable defaults without executing Python', async () => {
  const f = await fixture();
  try {
    await f.write('tools/check.py', 'raise RuntimeError("must never execute")\n');
    await withRuff(async (executable) => {
      const run = () =>
        spawnSync(
          executable,
          [
            'check',
            '--no-cache',
            '--config',
            path.join(projectRoot, 'ruff.toml'),
            'tools/check.py',
          ],
          {
            cwd: f.root,
            encoding: 'utf8',
            timeout: 10000,
          },
        );
      let result = run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      await f.write('tools/check.py', 'def broken(items=[]):\n    return unknown_name\n');
      result = run();
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /F821/);
      assert.match(result.stdout + result.stderr, /B006/);
    });
  } finally {
    await f.close();
  }
});
