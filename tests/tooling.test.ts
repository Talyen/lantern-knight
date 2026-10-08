import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { selectTestFiles } from '../tools/test';

import { reviewDiff } from '../tools/review-diff';
import { AssetCache } from '../tools/assets/cache';
import { execFileSync } from 'node:child_process';
import { verificationIdentity, requireStableInputs, guardedBuild } from '../tools/verification';
import { runChecks } from '../tools/check';

test('handoff cannot certify changed inputs and reports unrun gates after failure', async () => {
  const f = await fixture();
  try {
    const executed: string[] = [];
    const success = await runChecks(f.root, async (name) => {
      executed.push(name);
    });
    assert.equal(success.passed, true);
    assert.equal(executed.length, 8);
    assert.ok(success.steps.every((step) => step.status === 'passed'));
    const failed = await runChecks(f.root, async (name) => {
      if (name === 'tests') throw new Error('consequential regression');
    });
    assert.equal(failed.passed, false);
    assert.deepEqual(
      failed.steps.filter((s) => s.status === 'skipped').map((s) => s.name),
      ['assets', 'whitespace'],
    );
    const changed = await runChecks(f.root, async (name) => {
      if (name === 'tests') await f.write('tests/new.test.ts', 'export const changed=1;');
    });
    assert.equal(changed.passed, false);
    assert.equal(changed.steps.at(-1)!.name, 'source stability');
    const before = await verificationIdentity(f.root);
    await fs.mkdir(path.join(f.root, 'dist'));
    await f.write('dist/output.json', '{}');
    await requireStableInputs(f.root, before);
    const withoutPin = await verificationIdentity(f.root, { ignoreAssetPin: true });
    await fs.mkdir(path.join(f.root, 'assets'));
    await f.write('assets/lock.json', 'malformed pin does not affect pure tests');
    await requireStableInputs(f.root, withoutPin, { ignoreAssetPin: true });
    await f.write('.env.local', 'LANTERN_TEST_VALUE=changed');
    await assert.rejects(requireStableInputs(f.root, before), /Source inputs changed/);
  } finally {
    await f.close();
  }
});
test('source guard catches same-size tracked edits, deletion and untracked inputs without following links', async () => {
  const f = await fixture();
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.root, stdio: 'pipe' });
    git(['init', '--quiet']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    await f.write('tests/input.test.ts', 'one');
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'fixture']);
    const before = await verificationIdentity(f.root);
    await f.write('tests/input.test.ts', 'two');
    await assert.rejects(requireStableInputs(f.root, before), /Source inputs changed/);
    await f.write('tests/input.test.ts', 'one');
    await requireStableInputs(f.root, before);
    await fs.rm(path.join(f.root, 'tests/input.test.ts'));
    await assert.rejects(requireStableInputs(f.root, before), /Source inputs changed/);
    await f.write('tests/input.test.ts', 'one');
    await f.write('tools-new.ts', 'new');
    await assert.rejects(requireStableInputs(f.root, before), /Source inputs changed/);
    if (process.platform !== 'win32') {
      await fs.symlink(path.join(f.root, 'package.json'), path.join(f.root, 'linked.json'));
      await assert.rejects(verificationIdentity(f.root), /cannot follow symlink/);
    }
  } finally {
    await f.close();
  }
});

test('failed or stale builds remove verification stamps, including an earlier successful stamp', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'dist'));
    const stamp = path.join(f.root, 'dist/build-identity.json');
    await guardedBuild(f.root, stamp, async (inputs) => {
      await fs.writeFile(stamp, JSON.stringify(inputs));
    });
    assert.ok(await fs.stat(stamp));
    await assert.rejects(
      guardedBuild(f.root, stamp, async () => {
        throw new Error('build failed');
      }),
      /build failed/,
    );
    await assert.rejects(fs.stat(stamp), { code: 'ENOENT' });
    await assert.rejects(
      guardedBuild(f.root, stamp, async (inputs) => {
        await fs.writeFile(stamp, JSON.stringify(inputs));
        await f.write('tests/new.test.ts', 'changed');
      }),
      /Source inputs changed/,
    );
    await assert.rejects(fs.stat(stamp), { code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-tooling-')),
    root = path.join(temporary, 'repo');
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: { test: 'node test', build: 'node build', 'docs:check': 'node docs' },
    }),
  );
  return {
    root,
    write: (file: string, text: string) => fs.writeFile(path.join(root, file), text),
    close: () => fs.rm(temporary, { recursive: true, force: true }),
  };
}
test('test selection defaults to every suite and explicit paths select only the named suites', async () => {
  const f = await fixture();
  try {
    await f.write('tests/second.test.ts', '');
    await f.write('tests/first.test.ts', '');
    await f.write('tests/helper.ts', '');
    assert.deepEqual(await selectTestFiles([], f.root), [
      'tests/first.test.ts',
      'tests/second.test.ts',
    ]);
    assert.deepEqual(
      await selectTestFiles(
        ['./tests/second.test.ts', path.join(f.root, 'tests/second.test.ts')],
        f.root,
      ),
      ['tests/second.test.ts'],
    );
    for (const invalid of [
      'tests/missing.test.ts',
      'tests',
      '--unknown',
      'tests/helper.ts',
      '../first.test.ts',
      'tests/*.test.ts',
    ])
      await assert.rejects(
        selectTestFiles(['tests/first.test.ts', invalid], f.root),
        /Invalid test selection/,
      );
    await fs.rm(path.join(f.root, 'tests/first.test.ts'));
    await fs.rm(path.join(f.root, 'tests/second.test.ts'));
    await assert.rejects(selectTestFiles([], f.root), /No test suites/);
  } finally {
    await f.close();
  }
});

test('review retains staged reversals, renames, deletions and untracked paths outside selected patches', async () => {
  const f = await fixture();
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8' });
    git(['init', '--quiet']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    await f.write('reverse.txt', 'original\n');
    await f.write('old name.txt', 'renamed\n');
    await f.write('deleted.txt', 'delete me\n');
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'fixture']);
    await f.write('reverse.txt', 'staged\n');
    git(['add', 'reverse.txt']);
    await f.write('reverse.txt', 'original\n');
    git(['mv', 'old name.txt', 'new name.txt']);
    await fs.unlink(path.join(f.root, 'deleted.txt'));
    await f.write('new file.txt', 'new work\n');
    const cache = new AssetCache(path.join(path.dirname(f.root), 'cache'));
    const selected = await reviewDiff(f.root, ['reverse.txt'], { cache }),
      report = await fs.readFile(selected.report, 'utf8');
    assert.equal(selected.entries.length, 4);
    assert.ok(report.includes('new file.txt'));
    assert.ok(report.includes('deleted.txt'));
    assert.ok(report.includes('old name.txt'));
    assert.equal((report.match(/diff --git/g) ?? []).length, 2);
    assert.ok(report.includes('+staged'));
    assert.ok(report.includes('+original'));
    const full = await reviewDiff(f.root, [], { cache });
    assert.ok((await fs.readFile(full.report, 'utf8')).includes('+new work'));
    assert.ok((await fs.readFile(full.report, 'utf8')).includes('rename to new name.txt'));
    await assert.rejects(reviewDiff(f.root, ['../'], { cache }), /inside the checkout/);
    await assert.rejects(reviewDiff(f.root, ['unknown'], { cache }), /no changes/);
  } finally {
    await f.close();
  }
});

test('packaged Electron bundles may rely on built-ins but reject missing runtime packages', async () => {
  const { verifyElectronImports } = await import('../tools/build-electron');
  const metadata = (paths: string[]) => ({
    outputs: {
      'main.cjs': {
        imports: paths.map((path) => ({ path, external: true, kind: 'require-call' as const })),
        exports: [],
        inputs: {},
        bytes: 1,
      },
    },
  });
  verifyElectronImports(metadata(['electron', 'node:fs', 'path']));
  assert.throws(() => verifyElectronImports(metadata(['sharp'])), /unbundled runtime dependency/);
  assert.throws(
    () => verifyElectronImports(metadata(['.\/native.node'])),
    /unbundled runtime dependency/,
  );
});
