import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { setupWorktree } from '../../tools/setup-worktree';

test('code worktrees omit masters, authoring restores them, and unique source edits survive setup', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-worktree-scope-');
  const main = path.join(root, 'main'),
    task = path.join(root, 'task');
  await fs.mkdir(path.join(main, 'asset-data/sources'), { recursive: true });
  await fs.mkdir(path.join(main, 'asset-data/objects'), { recursive: true });
  await fs.writeFile(path.join(main, 'asset-data/sources/original'), 'source');
  await fs.writeFile(path.join(main, 'asset-data/objects/prepared'), 'prepared');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: main, stdio: 'pipe' });
  git('init', '-qb', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  git('worktree', 'add', '-b', 'task', task);
  assert.equal(setupWorktree(main), 'Primary checkout retained');
  setupWorktree(task);
  await assert.rejects(fs.access(path.join(task, 'asset-data/sources/original')), /ENOENT/);
  assert.equal(
    await fs.readFile(path.join(task, 'asset-data/objects/prepared'), 'utf8'),
    'prepared',
  );
  setupWorktree(task, true);
  assert.equal(await fs.readFile(path.join(task, 'asset-data/sources/original'), 'utf8'), 'source');
  await fs.writeFile(path.join(task, 'asset-data/sources/unique'), 'unfinished');
  assert.match(setupWorktree(task), /Source edits preserved/);
  assert.equal(
    await fs.readFile(path.join(task, 'asset-data/sources/unique'), 'utf8'),
    'unfinished',
  );
  await fs.rm(path.join(task, 'asset-data/sources/unique'));
  await fs.writeFile(path.join(task, '.gitignore'), 'asset-data/sources/local-only\n');
  await fs.writeFile(path.join(task, 'asset-data/sources/local-only'), 'ignored original');
  assert.match(setupWorktree(task), /Source edits preserved/);
  assert.equal(
    await fs.readFile(path.join(task, 'asset-data/sources/local-only'), 'utf8'),
    'ignored original',
  );
});
