import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { safeRelative } from './assets/paths';
import { AssetCache } from './assets/cache';
import { authoredInputs, inputFingerprint } from './authored-inputs';
import { dependencies, type ModuleGraph } from './module-graph';

export type InputSnapshot = {
  schemaVersion: 1;
  commit?: string | null;
  dirty?: boolean;
  files: Record<string, string>;
};
export type TaskState = {
  schemaVersion: 1;
  name: string;
  start: InputSnapshot;
  checked?: InputSnapshot;
  dependencies?: ModuleGraph;
  paths?: string[];
  commit?: string;
  inheritedDirty?: number;
  identity?: string;
};
export async function snapshot(root: string): Promise<InputSnapshot> {
  return { schemaVersion: 1, ...(await authoredInputs(root)) };
}
export function delta(before: InputSnapshot, after: InputSnapshot) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter((name) => before.files[name] !== after.files[name])
    .sort();
}
export function inputKey(inputs: InputSnapshot, names: readonly string[], salt: string) {
  return inputFingerprint(inputs.files, names, salt);
}
export async function taskDirectory(root: string) {
  const real = await fs.realpath(root);
  const id = createHash('sha256').update(real).digest('hex').slice(0, 24);
  const cache = new AssetCache();
  await cache.initialize();
  return path.join(cache.root, 'prototype-tasks', id);
}
async function withState<T>(root: string, work: (directory: string) => Promise<T>) {
  const directory = await taskDirectory(root);
  await fs.mkdir(directory, { recursive: true });
  return work(directory);
}
async function atomic(file: string, value: unknown) {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > 8 * 1024 ** 2)
    throw new Error('Prototype receipt exceeds its authored-input budget');
  const temporary = file + '.' + randomUUID();
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, file);
}
export async function startTask(root: string, name: string, paths: string[] = []) {
  const { taskStartArgs, agentContext } = await import('./agent-context');
  const parsed = taskStartArgs([name, ...(paths.length ? ['--paths', ...paths] : [])], root);
  const start = await snapshot(root);
  let commit: string | undefined, inheritedDirty: number | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const fields = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: root, encoding: 'utf8' },
    ).split('\0');
    inheritedDirty = 0;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;
      inheritedDirty++;
      if (/[RC]/.test(field.slice(0, 2))) i++;
    }
  } catch {
    /* Non-Git fixtures still have an authored snapshot identity. */
  }
  const identity = inputKey(start, Object.keys(start.files), 'task-baseline-v1');
  await withState(root, async (directory) =>
    atomic(path.join(directory, 'task.json'), {
      schemaVersion: 1,
      name,
      paths: parsed.paths,
      start,
      dependencies: await dependencies(root, start),
      commit,
      inheritedDirty,
      identity,
    }),
  );
  console.log((await agentContext(root)).text);
}
export async function taskBaseline(root: string) {
  return withState(root, async (directory) => {
    let state: TaskState;
    try {
      state = JSON.parse(await fs.readFile(path.join(directory, 'task.json'), 'utf8')) as TaskState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (state.schemaVersion !== 1 || !state.start?.files || !state.name)
      throw new Error('Invalid task snapshot; run task:start again');
    for (const name of Object.keys(state.start.files)) safeRelative(name);
    for (const name of state.paths ?? []) safeRelative(name);
    return state;
  });
}
export async function recordCheck(root: string, current: InputSnapshot) {
  await withState(root, async (directory) => {
    const file = path.join(directory, 'task.json');
    let state: TaskState;
    try {
      state = JSON.parse(await fs.readFile(file, 'utf8')) as TaskState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await atomic(file, {
      ...state,
      checked: current,
      dependencies: await dependencies(root, current),
    });
  });
}
export async function phaseEvidence<T>(
  root: string,
  phase: string,
  key: string,
  run: () => Promise<T>,
  valid: (result: T) => Promise<boolean> = async () => true,
): Promise<{ result: T; reused: boolean }> {
  return withState(root, async (directory) => {
    const file = path.join(
      directory,
      'phase-' + createHash('sha256').update(phase).digest('hex').slice(0, 20) + '.json',
    );
    try {
      const old = JSON.parse(await fs.readFile(file, 'utf8')) as {
        schemaVersion: number;
        key: string;
        result: T;
      };
      if (old.schemaVersion === 1 && old.key === key && (await valid(old.result)))
        return { result: old.result, reused: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
    }
    const result = await run();
    await atomic(file, { schemaVersion: 1, key, result });
    return { result, reused: false };
  });
}
