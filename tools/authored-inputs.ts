import { dependencies, dependencyClosure } from './module-graph';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export type AuthoredInputs = {
  files: Record<string, string>;
  commit: string | null;
  dirty: boolean;
};
export type InputOptions = {
  inputs?: AuthoredInputs;
  ignoreAssetPin?: boolean;
  scope?: 'verification' | 'runtime';
  files?: readonly string[];
};
const authored = (file: string) =>
  !/^(?:node_modules|staging|public|dist(?:-[^/]*)?|release(?:-[^/]*)?|evidence|tmp|references\/art)\//.test(
    file,
  ) &&
  (/\.(?:[cm]?[jt]sx?|json|glsl|css|html|md|txt|ya?ml|toml|sh|py)$/.test(file) ||
    /^(?:\.gitignore|\.npmrc|\.node-version|\.nvmrc|\.env(?:\..*)?)$/.test(file));
const runtime = (file: string) =>
  /^(?:src|electron)\//.test(file) ||
  /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|(?:index|sandbox|effects|editor)\.html|\.env(?:\..*)?|\.npmrc)$/.test(
    file,
  ) ||
  file === 'assets/lock.json' ||
  [
    'tools/authored-inputs.ts',
    'tools/source-identity.ts',
    'tools/verified-files.ts',
    'tools/compiler.ts',
    'tools/delivery.ts',
    'tools/task-runner.ts',
    'tools/commands.ts',
    'tools/task-context.ts',
    'tools/task-budget.ts',
    'tools/module-graph.ts',
    'tools/verification.ts',
    'tools/assets/authoring-catalog.ts',
    'tools/assets/loading-media.ts',
    'tools/assets/io.ts',
    'tools/assets/paths.ts',
  ].includes(file) ||
  /^tools\/(?:build[^/]*|select-runtime-assets|game-asset-catalog|session-replay)\.[^/]+$/.test(
    file,
  );

// One authored inventory and fingerprint serves task deltas, stability and builds.
// Dependency trees, prepared packs and the source library are never discovery inputs.
export async function authoredInputs(root: string): Promise<AuthoredInputs> {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 ** 2,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let names: string[] = [],
    commit: string | null = null,
    dirty = true;
  try {
    if (
      (await fs.realpath(git('rev-parse', '--show-toplevel').trim())) !== (await fs.realpath(root))
    )
      throw new Error('Source archive');
    names = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0');
    commit = git('rev-parse', 'HEAD').trim();
    dirty = !!git('status', '--porcelain').trim();
  } catch (error) {
    if (
      await fs.lstat(path.join(root, '.git')).then(
        () => true,
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        },
      )
    )
      throw error;
    const walk = async (directory: string) => {
      for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
        const file = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else names.push(file);
      }
    };
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) names.push(entry.name);
      else if (
        ['src', 'electron', 'tools', 'tests', 'authoring', 'docs', 'assets', '.github'].includes(
          entry.name,
        )
      )
        await walk(entry.name);
    }
  }
  names.push(...(await fs.readdir(root)).filter((name) => /^\.env(?:\..*)?$|^\.npmrc$/.test(name)));
  const files: Record<string, string> = {};
  for (const name of [...new Set(names)].filter((name) => name && authored(name)).sort()) {
    const file = path.join(root, name);
    const stat = await fs.lstat(file).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error('Authored inputs cannot follow symlink: ' + name);
    if (!stat.isFile()) throw new Error('Invalid authored input: ' + name);
    files[name] = createHash('sha256')
      .update(String(stat.mode))
      .update(await fs.readFile(file))
      .digest('hex');
  }
  return { files, commit, dirty };
}
export function inputFingerprint(
  files: Record<string, string>,
  names: readonly string[],
  salt: string,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([salt, [...new Set(names)].sort().map((name) => [name, files[name] ?? null])]),
    )
    .digest('hex');
}
export async function authoredIdentity(root: string, options: InputOptions = {}) {
  const inputs = options.inputs ?? (await authoredInputs(root));
  const runtimeDocuments = new Set<string>();
  let conservativeDocuments = false;
  if (options.scope === 'runtime') {
    const graph = await dependencies(root, { schemaVersion: 1, ...inputs });
    const entries = Object.keys(inputs.files).filter((file) => /^(?:src|electron)\//.test(file));
    const closure = graph && dependencyClosure(graph, entries);
    conservativeDocuments = !closure || closure.unresolved;
    for (const file of closure?.files ?? [])
      if (file.startsWith('authoring/')) runtimeDocuments.add(file);
  }
  const names = Object.keys(inputs.files).filter(
    (file) =>
      (!options.files || options.files.includes(file)) &&
      (!options.ignoreAssetPin || file !== 'assets/lock.json') &&
      (options.scope !== 'runtime' ||
        runtime(file) ||
        runtimeDocuments.has(file) ||
        (conservativeDocuments && file.startsWith('authoring/'))),
  );
  return {
    commit: inputs.commit,
    dirty: inputs.dirty,
    sha256: inputFingerprint(inputs.files, names, 'authored-inputs-v2'),
  };
}
