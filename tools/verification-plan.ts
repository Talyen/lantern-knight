import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { createVirtualFileSystem } from 'typescript/unstable/fs';

export type VerificationPlan = {
  base: string | null;
  changed: string[];
  suites: string[];
  full: boolean;
  reasons: string[];
  desktop: boolean;
};
const script = /\.[cm]?[jt]sx?$/;
const suite = /^tests\/[^/]+\.test\.ts$/;
const documents = (file: string) =>
  (file === '.rgignore' || /\.(?:md|txt)$/.test(file)) &&
  !/^(?:src|electron|tools|tests|authoring|assets)\//.test(file);
const shared = (file: string) =>
  /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|\.env(?:\..*)?|\.npmrc|\.node-version|\.nvmrc|\.gitignore|\.prettier[^/]*|ruff\.toml|\.oxlintrc\.json|knip\.json)$/.test(
    file,
  ) ||
  /^(?:\.github|\.githooks|\.codex)\//.test(file) ||
  /^tools\/(?:verification-plan|test|check|task-runner|task-budget|command-lane|run-process|verification|authored-inputs|lint|code-tools)\.ts$/.test(
    file,
  );

// These consumers read fixtures or launch code instead of importing it.
const extraDependencies: Readonly<Record<string, string[]>> = {
  'tests/library-import.test.ts': ['tests/library_import.py', 'tools/assets/library_import.py'],
  'tests/source-recovery.test.ts': [
    'tests/source_recovery.py',
    'tools/assets/source.py',
    'tools/assets/resolver.py',
    'tools/assets/library.py',
    'tools/assets/hero.py',
  ],
  'tests/ink.test.ts': ['tools/import-ink.py'],
  'tests/compiler.test.ts': ['tests/fixtures/valid.json'],
  'tests/processes.test.ts': ['authoring/session-opening.json'],
};

function git(root: string, args: string[], input?: string) {
  return execFileSync(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      input,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}
function names(output: string) {
  return output.split('\0').filter(Boolean);
}

export function changedInputs(root: string, base?: string) {
  const comparison = base
    ? git(root, ['rev-parse', '--verify', `${base}^{commit}`]).trim()
    : git(root, ['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
  // Separate index/worktree diffs retain staged reversals. --no-renames retains
  // both paths without parsing Git's rename records or quoting filenames.
  const changed = [
    ...new Set([
      ...names(git(root, ['diff', '--name-only', '--no-renames', '-z', comparison, 'HEAD'])),
      ...names(git(root, ['diff', '--name-only', '--no-renames', '--cached', '-z'])),
      ...names(git(root, ['diff', '--name-only', '--no-renames', '-z'])),
      ...names(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ]),
  ].sort();
  return { base: comparison, changed };
}

function graph(root: string, files: Map<string, string>, available: Set<string>) {
  const reverse = new Map<string, Set<string>>(),
    uncertain = new Set<string>();
  const edge = (consumer: string, dependency: string) => {
    const consumers = reverse.get(dependency) ?? new Set<string>();
    consumers.add(consumer);
    reverse.set(dependency, consumers);
  };
  // The E2E dispatcher imports a finite authored phase list through `module`.
  // Its path literals below supply the edges; edits to the dispatcher itself
  // always broaden verification rather than trusting this exception.
  const phaseDispatcher = (file: string, specifier: ts.Node) =>
    /^(?:tools\/smoke\/e2e|tools\/e2e)\.ts$/.test(file) &&
    ts.isIdentifier(specifier) &&
    specifier.text === 'module';
  const config = path.join(root, '__verification_graph__.json');
  const virtual: Record<string, string> = Object.fromEntries(
    [...files].map(([name, text]) => [path.resolve(root, name), text]),
  );
  virtual[config] = JSON.stringify({
    compilerOptions: {
      allowJs: true,
      noEmit: true,
      noLib: true,
      types: [],
      module: 'esnext',
      moduleResolution: 'bundler',
    },
    files: [...files.keys()]
      .filter((name) => script.test(name))
      .map((name) => path.resolve(root, name)),
  });
  const api = new API({ cwd: root, fs: createVirtualFileSystem(virtual) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    try {
      const project = snapshot.getProject(config);
      if (!project) throw new Error('Cannot open verification dependency graph');
      for (const file of files.keys()) {
        if (!script.test(file)) continue;
        const source = project.program.getSourceFile(path.resolve(root, file));
        if (!source) throw new Error('Cannot parse verification input: ' + file);
        const visit = (node: ts.Node) => {
          let specifier: ts.Node | undefined;
          if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            specifier = node.moduleSpecifier;
          else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
          )
            specifier = node.moduleReference.expression;
          else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
            specifier = node.argument.literal;
          else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          )
            specifier = node.arguments[0];
          if (specifier) {
            if (
              !ts.isStringLiteral(specifier) &&
              !ts.isNoSubstitutionTemplateLiteral(specifier) &&
              !phaseDispatcher(file, specifier)
            )
              uncertain.add(file);
            else if (
              (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) &&
              specifier.text.startsWith('.')
            ) {
              const target = path.posix.normalize(
                path.posix.join(path.posix.dirname(file), specifier.text),
              );
              const stem = target.replace(/\.[cm]?jsx?$/, '');
              const emitted = /\.[cm]?jsx?$/.test(target);
              const extensions = target.endsWith('.mjs')
                ? ['.mts', '.d.mts']
                : target.endsWith('.cjs')
                  ? ['.cts', '.d.cts']
                  : target.endsWith('.jsx')
                    ? ['.tsx', '.d.ts']
                    : ['.ts', '.tsx', '.d.ts'];
              const candidates = [
                ...(emitted ? extensions.map((ext) => stem + ext) : []),
                target,
                ...[
                  '.ts',
                  '.tsx',
                  '.d.ts',
                  '.mts',
                  '.cts',
                  '.js',
                  '.jsx',
                  '.mjs',
                  '.cjs',
                  '/index.ts',
                  '/index.js',
                ].map((ext) => stem + ext),
              ];
              const resolved = candidates.find((name) => available.has(name));
              if (resolved) edge(file, resolved);
              else uncertain.add(file);
            } else if (
              (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) &&
              specifier.text.startsWith('#')
            )
              uncertain.add(file);
          }
          // Repository-path literals cover CLI launches and readFile fixtures.
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (available.has(node.text)) edge(file, node.text);
            if (node.text.startsWith('.')) {
              const target = path.posix.normalize(
                path.posix.join(path.posix.dirname(file), node.text),
              );
              if (available.has(target)) edge(file, target);
            }
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
  for (const [consumer, dependencies] of Object.entries(extraDependencies))
    if (available.has(consumer)) for (const dependency of dependencies) edge(consumer, dependency);
  return { reverse, uncertain };
}

export function affectedVerification(
  root: string,
  base: string,
  changed: string[],
  current: Map<string, string>,
  previous: Map<string, string>,
  currentNames = new Set(current.keys()),
  previousNames = new Set(previous.keys()),
): VerificationPlan {
  const all = [...currentNames].filter((name) => suite.test(name)).sort();
  const full = (reason: string): VerificationPlan => ({
    base,
    changed,
    suites: all,
    full: true,
    reasons: [reason],
    desktop: true,
  });
  if (
    changed.some(shared) ||
    changed.some((file) => /^(?:tools\/smoke\/e2e|tools\/e2e)\.ts$/.test(file))
  )
    return full('Shared verification or configuration inputs changed');
  const relevant = changed.filter((file) => !documents(file));
  if (!relevant.length)
    return {
      base,
      changed,
      suites: [],
      full: false,
      reasons: [changed.length ? 'Documentation-only changes' : 'No changed inputs'],
      desktop: false,
    };
  const before = graph(root, previous, previousNames),
    after = graph(root, current, currentNames);
  const touched = new Set(relevant),
    pending = [...relevant];
  for (let i = 0; i < pending.length; i++) {
    const file = pending[i]!;
    for (const consumer of [
      ...(before.reverse.get(file) ?? []),
      ...(after.reverse.get(file) ?? []),
    ])
      if (!touched.has(consumer)) {
        touched.add(consumer);
        pending.push(consumer);
      }
  }
  const uncertain = [...touched].filter(
    (file) => before.uncertain.has(file) || after.uncertain.has(file),
  );
  if (uncertain.length)
    return full(
      'Affected code has unresolved or computed dependencies: ' + uncertain.slice(0, 3).join(', '),
    );
  const selected = all.filter((file) => touched.has(file));
  if (
    relevant.some(
      (file) => !suite.test(file) && !before.reverse.has(file) && !after.reverse.has(file),
    )
  )
    return full('Changed inputs have no established test consumers');
  if (!selected.length) return full('Changed executable inputs have no surviving affected suites');
  const desktop =
    relevant.some(
      (file) =>
        /^(?:src|electron|authoring|assets)\//.test(file) ||
        /^tools\/(?:smoke|scene)\//.test(file) ||
        /^tools\/(?:build[^/]*|package[^/]*|select-runtime-assets|compiler|check-assets|check-quality|prepare[^/]*)\.[^/]+$/.test(
          file,
        ) ||
        /^tools\/assets\//.test(file),
    ) || [...touched].some((file) => /^(?:src|electron)\//.test(file));
  return {
    base,
    changed,
    suites: selected,
    full: false,
    reasons: ['Tests consuming changed inputs in the baseline or current graph'],
    desktop,
  };
}

export async function verificationPlan(
  root: string,
  options: { base?: string; full?: boolean; prototype?: boolean } = {},
): Promise<VerificationPlan> {
  const suites = (await fs.readdir(path.join(root, 'tests'), { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.endsWith('.test.ts'))
    .map((file) => 'tests/' + file.name)
    .sort();
  if (!suites.length) throw new Error('No test suites found.');
  if (options.full)
    return {
      base: null,
      changed: [],
      suites,
      full: true,
      reasons: ['Explicit full verification'],
      desktop: true,
    };
  if (options.prototype) {
    const { taskBaseline, snapshot, delta } = await import('./task-state');
    const task = await taskBaseline(root);
    if (task) {
      const current = await snapshot(root),
        previous = task.checked ?? task.start;
      const changed = delta(previous, current);
      const plan = affectedVerification(
        root,
        'task:' + task.name,
        changed,
        new Map(Object.entries(current.scripts)),
        new Map(Object.entries(previous.scripts)),
        new Set(Object.keys(current.files)),
        new Set(Object.keys(previous.files)),
      );
      if (!plan.full) return plan;
      const families = new Set<string>();
      for (const file of changed) for (const name of prototypeOwners(file)) families.add(name);
      return {
        ...plan,
        full: false,
        suites: suites.filter((file) => families.has(file)),
        reasons: [
          'Task delta; subsystem fallback for unresolved dependencies. Exhaustive coverage belongs to integration/CI.',
        ],
      };
    }
  }
  let comparison: ReturnType<typeof changedInputs> | undefined;
  try {
    comparison = changedInputs(root, options.base);
    if (!comparison.changed.some((file) => !documents(file)))
      return {
        ...comparison,
        suites: [],
        full: false,
        reasons: [comparison.changed.length ? 'Documentation-only changes' : 'No changed inputs'],
        desktop: false,
      };
    if (comparison.changed.some(shared))
      return {
        ...comparison,
        suites,
        full: true,
        reasons: ['Shared verification or configuration inputs changed'],
        desktop: true,
      };
    // The current project uses relative module paths. Until aliases have a
    // graph owner, never silently interpret them as external dependencies.
    try {
      const config = JSON.parse(await fs.readFile(path.join(root, 'tsconfig.json'), 'utf8'));
      if (config.extends || config.compilerOptions?.paths || config.compilerOptions?.baseUrl)
        throw new Error('Custom TypeScript resolution requires full verification');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const currentNames = new Set(
      names(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])),
    );
    const previousNames = new Set(
      names(git(root, ['ls-tree', '-r', '--name-only', '-z', comparison.base])),
    );
    const current = new Map<string, string>(),
      previous = new Map<string, string>();
    // Read only authored scripts. Imported JSON participates by filename; no
    // generated catalogs, dependency locks or artwork need to be opened.
    for (const file of currentNames)
      if (script.test(file)) {
        try {
          if ((await fs.lstat(path.join(root, file))).isSymbolicLink())
            throw new Error('Verification cannot follow a source symlink: ' + file);
          current.set(file, await fs.readFile(path.join(root, file), 'utf8'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          currentNames.delete(file);
        }
      }
    const baseScripts = [...previousNames].filter((file) => script.test(file));
    const blobs = git(
      root,
      ['cat-file', '--batch'],
      baseScripts.map((file) => `${comparison!.base}:${file}\n`).join(''),
    );
    const buffer = Buffer.from(blobs);
    let offset = 0;
    for (const file of baseScripts) {
      const end = buffer.indexOf(10, offset),
        header = buffer.subarray(offset, end).toString();
      const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
      if (!match) throw new Error('Cannot read baseline script: ' + file);
      const length = Number(match[1]);
      previous.set(file, buffer.subarray(end + 1, end + 1 + length).toString());
      offset = end + 2 + length;
    }
    return affectedVerification(
      root,
      comparison.base,
      comparison.changed,
      current,
      previous,
      currentNames,
      previousNames,
    );
  } catch (error) {
    return {
      base: comparison?.base ?? null,
      changed: comparison?.changed ?? [],
      suites,
      full: true,
      reasons: ['Conservative full fallback: ' + (error as Error).message.split('\n')[0]],
      desktop: true,
    };
  }
}

export type ContextRoute = {
  name: string;
  match: RegExp;
  entries: string[];
  docs: string[];
  suites: string[];
  skills?: string[];
};
// Ordered ownership routes serve prototype fallback and agent discovery together.
export const contextRoutes: ContextRoute[] = [
  {
    name: 'saved state',
    match: /^src\/core\/(?:save|persistence)/,
    entries: [
      'src/core/save.ts#parseGame',
      'src/core/persistence.ts#Persistence',
      'src/core/session.ts#GameSession',
    ],
    docs: ['docs/foundation.md#change-saved-state'],
    suites: ['persistence'],
  },
  {
    name: 'simulation/input',
    match: /^src\/core\/(?:session|simulation|input)/,
    entries: [
      'src/core/simulation.ts#Simulation',
      'src/core/session.ts#GameSession',
      'src/core/input.ts#Input',
    ],
    docs: ['docs/foundation.md#change-action-timing-or-presentation'],
    suites: ['systems', 'hero-actions'],
  },
  {
    name: 'application/UI',
    match: /^src\/(?:application|main|sandbox|game-ui|loading-screen)/,
    entries: ['src/application.ts#Application', 'src/game-ui.ts#bindGameUI'],
    docs: ['docs/foundation.md#change-player-menus-or-settings'],
    suites: ['application', 'systems'],
  },
  {
    name: 'presentation',
    match: /^src\/presentation\//,
    entries: [
      'src/presentation/game-scene.ts#GamePresentation',
      'src/presentation/room-presentation.ts#RoomPresentation',
    ],
    docs: ['docs/foundation.md#change-action-timing-or-presentation'],
    suites: ['foundation', 'lighting'],
  },
  {
    name: 'content/scenes',
    match: /^src\/content\/|^authoring\//,
    entries: [
      'src/content/game-content.ts#contentDefinitions',
      'src/content/scene-document.ts#parseSceneDocument',
    ],
    docs: ['docs/foundation.md#add-an-area-or-enemy', 'docs/scene-design.md'],
    suites: ['scene-design', 'scene-editor', 'systems'],
    skills: ['lantern-scene-design for production scenes'],
  },
  {
    name: 'assets',
    match: /^src\/assets\/|^(?:assets\/|tools\/assets\/|tools\/prepare)/,
    entries: ['tools/assets/recipe.ts#preparationSelection', 'tools/assets/pack.ts#readLock'],
    docs: ['docs/assets.md#local-preparation-review'],
    suites: ['asset-packs', 'validation-plan', 'bitmap'],
    skills: ['lantern-art-direction for artwork generation/editing'],
  },
  {
    name: 'desktop/storage',
    match: /^electron\//,
    entries: ['electron/main.ts', 'electron/store.ts#Store'],
    docs: ['docs/foundation.md#change-saved-state', 'docs/release.md'],
    suites: ['foundation', 'persistence'],
  },
  {
    name: 'browser tooling',
    match: /^tools\/(?:scene|smoke)/,
    entries: [
      'tools/scene/scene-workflow.ts#checkScene',
      'tools/scene/prototype-browser.ts#prototypeProbe',
    ],
    docs: ['docs/verification.md#scene-workflow'],
    suites: ['application', 'scene-editor'],
  },
  {
    name: 'verification/tooling',
    match:
      /^(?:tools\/|tests\/)|^(?:package|tsconfig|vite\.config|\.github\/|\.codex\/|\.githooks\/)/,
    entries: [
      'tools/task-runner.ts#commands',
      'tools/verification-plan.ts#verificationPlan',
      'tools/test.ts#runTests',
    ],
    docs: ['docs/verification.md#regular-checks'],
    suites: ['task-runner', 'verification-plan', 'tooling', 'code-tools'],
  },
  {
    name: 'documentation',
    match: /(?:^\.rgignore$|\.(?:md|txt)$)/,
    entries: ['CONTRIBUTING.md'],
    docs: ['CONTRIBUTING.md#review-and-investigation'],
    suites: [],
  },
];
export function contextOwner(file: string) {
  return contextRoutes.find((route) => route.match.test(file));
}
export function entryLocation(reference: string, source?: string) {
  const [file, symbol] = reference.split('#');
  if (!symbol) return file!;
  const declaration = new RegExp(
    '^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|type|interface)\\s+' +
      symbol +
      '\\b',
  );
  const line = source?.split('\n').findIndex((text) => declaration.test(text));
  return line === undefined || line < 0 ? undefined : file + ':' + (line + 1);
}
function prototypeOwners(file: string): string[] {
  if (/^tests\/[^/]+\.test\.ts$/.test(file)) return [file];
  const route = contextOwner(file);
  // Keep the original broad fallback for unknown executable/configuration inputs.
  const names =
    route?.suites ??
    (shared(file)
      ? ['task-runner', 'verification-plan', 'tooling', 'code-tools']
      : documents(file)
        ? []
        : ['foundation', 'systems']);
  return names.map((name) => 'tests/' + name + '.test.ts');
}

export async function dependencyInputs(
  root: string,
  entries: string[],
  inputs?: import('./task-state').InputSnapshot,
) {
  const current = inputs ?? (await (await import('./task-state')).snapshot(root));
  const files = new Map(Object.entries(current.scripts)),
    available = new Set(Object.keys(current.files));
  const { reverse, uncertain } = graph(root, files, available);
  const forward = new Map<string, Set<string>>();
  for (const [dependency, consumers] of reverse)
    for (const consumer of consumers) {
      const names = forward.get(consumer) ?? new Set<string>();
      names.add(dependency);
      forward.set(consumer, names);
    }
  const selected = new Set(entries),
    pending = [...entries];
  for (let i = 0; i < pending.length; i++) {
    const name = pending[i]!;
    if (uncertain.has(name)) {
      // Keep reuse conservative for dynamic test/tool consumers, without broadening execution.
      for (const file of available)
        if (/^(?:src|electron|tools|authoring|assets)\//.test(file)) selected.add(file);
    }
    for (const dependency of forward.get(name) ?? [])
      if (!selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
  }
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) selected.add(file);
  return [...selected].sort();
}

export async function ciDesktopRequired(root: string, event: string, base?: string) {
  if (event !== 'pull_request') return true;
  if (!base || !/^[a-f0-9]{40,64}$/.test(base)) return true;
  return (await verificationPlan(root, { base })).desktop;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).join(' ') !== '--ci') throw new Error('Use verification-plan --ci');
  const required = await ciDesktopRequired(
    process.cwd(),
    process.env.GITHUB_EVENT_NAME ?? '',
    process.env.LANTERN_CI_BASE,
  );
  console.log(`Desktop CI required: ${required}.`);
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(process.env.GITHUB_OUTPUT, `desktop=${required}\n`);
}
