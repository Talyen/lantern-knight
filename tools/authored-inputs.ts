import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Authored inputs only: never walk installed dependencies, packs or the library.
const inputPath = (file: string) =>
  !/^(?:node_modules|staging|public|dist(?:-[^/]*)?|release(?:-[^/]*)?|evidence|tmp|references\/art)\//.test(
    file,
  ) &&
  (/\.(?:[cm]?[jt]sx?|json|glsl|css|html|md|txt|ya?ml|toml|sh|py)$/.test(file) ||
    /^(?:\.gitignore|\.npmrc|\.node-version|\.nvmrc|\.env(?:\..*)?)$/.test(file));
export async function authoredIdentity(
  root: string,
  options: {
    ignoreAssetPin?: boolean;
    scope?: 'verification' | 'runtime';
    files?: readonly string[];
  } = {},
) {
  const git = (args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  let commit: string | null = null,
    dirty = true,
    names: string[];
  try {
    const top = git(['rev-parse', '--show-toplevel']).trim();
    if ((await fs.realpath(top)) !== (await fs.realpath(root))) throw new Error('Source archive');
    commit = git(['rev-parse', 'HEAD']).trim();
    names = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean);
    dirty = !!git(['status', '--porcelain']).trim();
  } catch (error) {
    // An archive has no Git attribution, but still needs stable authored inputs.
    if (
      await fs.lstat(path.join(root, '.git')).then(
        () => true,
        (err) => {
          if (err.code === 'ENOENT') return false;
          throw err;
        },
      )
    )
      throw error;
    names = [];
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
  const runtimeDocuments = new Set<string>();
  if (options.scope === 'runtime') {
    const api = new API({ cwd: root });
    try {
      const config = path.join(root, 'tsconfig.json'),
        snapshot = api.updateSnapshot({ openProjects: [config] });
      try {
        const project = snapshot.getProject(config);
        if (!project) throw new Error('Runtime identity requires tsconfig.json');
        for (const file of names.filter((f) => f.startsWith('src/') && f.endsWith('.ts'))) {
          const source = project.program.getSourceFile(path.join(root, file));
          if (!source) {
            if (
              !(await fs.access(path.join(root, file)).then(
                () => true,
                () => false,
              ))
            )
              continue;
            throw new Error('Runtime identity source is outside tsconfig: ' + file);
          }
          const visit = (node: ts.Node) => {
            let specifier: ts.Node | undefined;
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
              specifier = node.moduleSpecifier;
            else if (
              ts.isImportEqualsDeclaration(node) &&
              ts.isExternalModuleReference(node.moduleReference)
            )
              specifier = node.moduleReference.expression;
            else if (
              ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
            )
              specifier = node.arguments[0];
            if (
              specifier &&
              (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) &&
              specifier.text.endsWith('.json')
            ) {
              const declaration = project.checker
                .getSymbolAtLocation(specifier)
                ?.declarations.find((n) => n.kind === ts.SyntaxKind.SourceFile)
                ?.resolve(project);
              const absolute =
                declaration && ts.isSourceFile(declaration)
                  ? declaration.fileName
                  : path.resolve(root, path.dirname(file), specifier.text);
              const target = path.relative(root, absolute).split(path.sep).join('/');
              if (target.startsWith('authoring/')) runtimeDocuments.add(target);
            }
            node.forEachChild(visit);
          };
          visit(source);
        }
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  }
  const runtimeInput = (file: string) =>
    file.startsWith('src/') ||
    file.startsWith('electron/') ||
    runtimeDocuments.has(file) ||
    [
      'package.json',
      'package-lock.json',
      'assets/lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'sandbox.html',
      'effects.html',
      'editor.html',
      'tools/session-replay.ts',
      'tools/source-identity.ts',
      'tools/authored-inputs.ts',
      'tools/build-electron.ts',
      'tools/build-identity.ts',
      'tools/select-runtime-assets.ts',
      'tools/game-asset-catalog.ts',
      'tools/task-runner.ts',
      'tools/assets/authoring-catalog.ts',
    ].includes(file) ||
    /^\.env(?:\..*)?$|^\.npmrc$/.test(file);
  const hash = createHash('sha256');
  // Ignored root build configuration still affects the candidate. Hash only;
  // never expose environment-file contents in diagnostics.
  names.push(...(await fs.readdir(root)).filter((file) => /^\.env(?:\..*)?$|^\.npmrc$/.test(file)));
  for (const file of [...new Set(names)]
    .filter(
      (file) =>
        inputPath(file) &&
        (!options.files || options.files.includes(file)) &&
        (!options.ignoreAssetPin || file !== 'assets/lock.json') &&
        (options.scope !== 'runtime' || runtimeInput(file)),
    )
    .sort()) {
    hash.update(file + '\0');
    try {
      const stat = await fs.lstat(path.join(root, file));
      if (stat.isSymbolicLink()) throw new Error(`Source identity cannot follow symlink: ${file}`);
      if (!stat.isFile()) throw new Error(`Invalid source input: ${file}`);
      hash.update(String(stat.mode) + '\0');
      hash.update(await fs.readFile(path.join(root, file)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('deleted');
    }
    hash.update('\0');
  }
  return { commit, dirty, sha256: hash.digest('hex') };
}
