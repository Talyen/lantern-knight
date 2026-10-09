import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';

const directories = ['src', 'electron', 'tools', 'tests'];
const excluded =
  /(?:^|\/)(?:node_modules|references|public|staging|dist[^/]*|release[^/]*|evidence|tmp|\.git|__pycache__)(?:\/|$)/;
export async function codeFiles(root = projectRoot) {
  let names: string[];
  if (
    await fs.lstat(path.join(root, '.git')).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    )
  ) {
    names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 ** 2,
    }).split('\0');
  } else {
    names = [];
    const walk = async (directory: string) => {
      for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
        const file = path.posix.join(directory, entry.name);
        if (excluded.test(file)) continue;
        if (entry.isDirectory()) await walk(file);
        else names.push(file);
      }
    };
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) names.push(entry.name);
      else if (directories.includes(entry.name)) await walk(entry.name);
    }
  }
  const files: string[] = [];
  for (const name of [...new Set(names)].sort()) {
    if (
      !/^(?:(?:src|electron|tools|tests)\/|[^/]+$)/.test(name) ||
      excluded.test(name) ||
      !/\.(?:[cm]?[jt]sx?|css|html|py)$/.test(name)
    )
      continue;
    const stat = await fs.lstat(path.join(root, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error('Code tools cannot follow symlink: ' + name);
    if (stat?.isFile()) files.push(name);
  }
  if (process.env.LANTERN_CHECK_FILES) {
    const selected: unknown = JSON.parse(process.env.LANTERN_CHECK_FILES);
    if (!Array.isArray(selected) || selected.some((file) => typeof file !== 'string'))
      throw new Error('Invalid authored code selection');
    return files.filter((file) => selected.includes(file));
  }
  return files;
}

export async function quietRun(command: string, args: string[], root = projectRoot) {
  let log = '';
  try {
    await runProcess(command, args, {
      cwd: root,
      timeoutMs: 120000,
      output: (chunk) => {
        log = (log + chunk.toString()).slice(-12000);
      },
    });
  } catch (error) {
    console.error(log);
    throw error;
  }
}

export async function withRuff<T>(work: (executable: string) => Promise<T>) {
  const executable = path.join(
    projectRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'ruff.exe' : 'ruff',
  );
  if (
    !(await fs.access(executable).then(
      () => true,
      () => false,
    ))
  )
    throw new Error('Set up the authoring .venv with Ruff 0.16.10 before explicit Python checks');
  return work(executable);
}
