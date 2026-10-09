import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, taskBaseline, delta, type InputSnapshot } from './task-state';
import { dependencies, dependencyClosure, type ModuleGraph } from './module-graph';

export type VerificationPlan = {
  base: string | null;
  changed: string[];
  suites: string[];
  full: boolean;
  reasons: string[];
  desktop: boolean;
};
const documents = (file: string) =>
  /^(?:references|docs|\.agents)\//.test(file) ||
  file === '.rgignore' ||
  (/\.(?:md|txt)$/.test(file) && !/^(?:src|electron|tools|tests|authoring|assets)\//.test(file));
const shared = (file: string) =>
  /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|\.env(?:\..*)?|\.npmrc|\.node-version|\.nvmrc)$/.test(
    file,
  );
const desktop = (file: string) =>
  shared(file) ||
  /^(?:src|electron)\//.test(file) ||
  file === 'assets/lock.json' ||
  /^tools\/(?:build|select-runtime|game-asset|smoke|scene|task-runner|command-lane|run-process|verification|authored)/.test(
    file,
  );
function git(root: string, args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 ** 2,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const names = (text: string) => text.split('\0').filter(Boolean);
export function changedInputs(root: string, base?: string) {
  const comparison = base
    ? git(root, ['rev-parse', '--verify', `${base}^{commit}`]).trim()
    : git(root, ['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
  return {
    base: comparison,
    changed: [
      ...new Set([
        ...names(git(root, ['diff', '--name-only', '--no-renames', '-z', comparison, 'HEAD'])),
        ...names(git(root, ['diff', '--name-only', '--no-renames', '--cached', '-z'])),
        ...names(git(root, ['diff', '--name-only', '--no-renames', '-z'])),
        ...names(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
      ]),
    ].sort(),
  };
}
export async function verificationPlan(
  root: string,
  options: { base?: string; full?: boolean; prototype?: boolean; inputs?: InputSnapshot } = {},
): Promise<VerificationPlan> {
  const suites = (await fs.readdir(path.join(root, 'tests'), { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.endsWith('.test.ts'))
    .map((file) => 'tests/' + file.name)
    .sort();
  if (!suites.length) throw new Error('No test suites found.');
  const inputs = options.inputs ?? (await snapshot(root));
  const graph = await dependencies(root, inputs);
  let prior: ModuleGraph | undefined;
  let base: string | null = null,
    changed: string[] = [];
  let full = !!options.full;
  const reasons: string[] = [];
  if (full) reasons.push('Explicit full verification');
  else
    try {
      const task = options.prototype && (await taskBaseline(root));
      if (task) {
        base = 'task:' + task.name;
        prior = task.dependencies;
        changed = delta(task.checked ?? task.start, inputs);
      } else ({ base, changed } = changedInputs(root, options.base));
      full = changed.some(
        (file) =>
          shared(file) ||
          (!graph && /^tests\//.test(file) && !/^tests\/[^/]+\.test\.ts$/.test(file)) ||
          (!documents(file) && !contextOwner(file)) ||
          (/^tests\/[^/]+\.test\.ts$/.test(file) && !suites.includes(file)),
      );
      reasons.push(
        full
          ? 'Shared or unknown inputs; conservative full coverage'
          : 'Changed subsystem owners; layout details are not test expectations',
      );
    } catch {
      full = true;
      reasons.push('Unavailable comparison baseline; conservative full coverage');
    }
  const selected = graph
    ? affectedSuites(graph, suites, changed, prior)
    : new Set(
        changed.flatMap((file) =>
          documents(file)
            ? []
            : /^tests\/[^/]+\.test\.ts$/.test(file)
              ? [file]
              : (contextOwner(file)?.suites ?? []).map((name) => 'tests/' + name + '.test.ts'),
        ),
      );
  if (graph) reasons.push('Compiler-resolved consumers and declared non-import inputs');
  return {
    base,
    changed,
    full,
    reasons,
    suites: full ? suites : suites.filter((file) => selected.has(file)),
    desktop: full || changed.some(desktop),
  };
}

export type ContextRoute = {
  name: string;
  match: RegExp;
  entries: string[];
  docs: string[];
  suites: string[];
  skills?: string[];
};
// Owners serve discovery and fallback; compiler consumers own normal selection.
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
    suites: [
      'foundation',
      'lighting',
      'animation-sampling',
      'visual-effects',
      'frame-scheduler',
      'graveyard-art',
      'crypt',
      'scene-surround',
      'ink',
      'hero-art',
    ],
  },
  {
    name: 'prototype scene',
    match: /^authoring\/scenes\//,
    entries: [
      'src/content/scene-document.ts#parseSceneDocument',
      'src/content/scene-design.ts#validateSceneDesign',
    ],
    docs: ['docs/scene-design.md', 'docs/verification.md#scene-workflow'],
    suites: ['scene-design', 'scene-editor'],
  },
  {
    name: 'content/scenes',
    match: /^src\/content\/|^authoring\//,
    entries: [
      'src/content/game-content.ts#contentDefinitions',
      'src/content/scene-document.ts#parseSceneDocument',
    ],
    docs: ['docs/foundation.md#add-an-area-or-enemy', 'docs/scene-design.md'],
    suites: ['scene-design', 'scene-editor', 'systems', 'hero-actions', 'churchyard'],
    skills: ['lantern-scene-design for production scenes'],
  },
  {
    name: 'assets',
    match: /^src\/assets\/|^(?:assets\/|tools\/assets\/|tools\/prepare)/,
    entries: ['tools/assets/recipe.ts#preparationSelection', 'tools/assets/pack.ts#readLock'],
    docs: ['docs/assets.md#local-preparation-review'],
    suites: ['asset-packs', 'asset-finalization', 'validation-plan', 'bitmap', 'compiler'],
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
      'tools/commands.ts#commands',
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
export function affectedSuites(
  graph: ModuleGraph,
  suites: string[],
  changed: string[],
  prior?: ModuleGraph,
) {
  const selected = new Set<string>();
  const executable = changed.filter((file) => !documents(file));
  for (const suite of suites) {
    const current = dependencyClosure(graph, [suite]);
    const previous = prior && dependencyClosure(prior, [suite]);
    if (
      executable.some((file) => current.files.has(file) || previous?.files.has(file)) ||
      (executable.length && (current.unresolved || previous?.unresolved))
    )
      selected.add(suite);
  }
  for (const file of executable) {
    if (
      selected.has(file) ||
      suites.some((suite) => dependencyClosure(graph, [suite]).files.has(file))
    )
      continue;
    // Unimported authored inventories still have conservative subsystem owners.
    for (const name of contextOwner(file)?.suites ?? []) {
      const suite = 'tests/' + name + '.test.ts';
      if (suites.includes(suite)) selected.add(suite);
    }
  }
  return selected;
}
export async function dependencyInputs(root: string, entries: string[], inputs?: InputSnapshot) {
  const current = inputs ?? (await snapshot(root));
  const graph = await dependencies(root, current);
  const closure = graph && dependencyClosure(graph, entries);
  return [
    ...new Set([
      ...entries,
      ...Object.keys(current.files).filter(
        (file) =>
          shared(file) ||
          (closure && !closure.unresolved
            ? closure.files.has(file)
            : /^(?:src|electron|authoring|assets|tools|tests\/fixtures)\//.test(file)),
      ),
    ]),
  ].sort();
}
export async function ciDesktopRequired(root: string, event: string, base?: string) {
  if (event !== 'pull_request' || !base || !/^[a-f0-9]{40,64}$/.test(base)) return true;
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
