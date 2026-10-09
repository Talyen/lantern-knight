import path from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import type { InputSnapshot } from './task-state';

export type ModuleGraph = { dependencies: Record<string, string[]>; unresolved: string[] };
type Project = NonNullable<ReturnType<ReturnType<API['updateSnapshot']>['getProject']>>;
export function inspectImports(
  project: Project,
  source: ts.SourceFile,
  visit: (edge: { name?: string; resolved?: string; line: number; typeOnly?: boolean }) => void,
) {
  const inspect = (node: ts.Node) => {
    let specifier: ts.Node | undefined;
    const typeOnly =
      ts.isImportTypeNode(node) ||
      (ts.isImportDeclaration(node) &&
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) ||
      (ts.isExportDeclaration(node) && node.isTypeOnly);
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
      const line = source.text.slice(0, node.getStart(source)).split('\n').length;
      if (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier))
        visit({ line });
      else {
        const declaration = project.checker
          .getSymbolAtLocation(specifier)
          ?.declarations.find((node) => node.kind === ts.SyntaxKind.SourceFile)
          ?.resolve(project);
        visit({
          name: specifier.text,
          resolved: declaration && ts.isSourceFile(declaration) ? declaration.fileName : undefined,
          line,
          typeOnly,
        });
      }
    }
    node.forEachChild(inspect);
  };
  inspect(source);
}

const graphs = new WeakMap<
  InputSnapshot['files'],
  { root: string; value: Promise<ModuleGraph | undefined> }
>();
export function dependencies(root: string, inputs: InputSnapshot) {
  let cached = graphs.get(inputs.files);
  if (!cached || cached.root !== root) {
    cached = { root, value: moduleGraph(root, inputs) };
    graphs.set(inputs.files, cached);
  }
  return cached.value;
}

// Files read outside module imports. Prefixes represent deliberately dynamic inventories.
const additionalInputs: Record<string, string[]> = {
  'tools/assets/recipe.ts': ['assets/recipe.json', 'assets/', 'authoring/', 'tools/prepare'],
  'tools/assets/pack.ts': ['assets/lock.json'],
  'tools/scene/scene-editor-store.ts': ['authoring/scenes/'],
  'tools/scene/prototype-browser.ts': ['tools/scene/scene-browser.cjs', 'vite.config.ts'],
  'tools/scene/scene-workflow.ts': ['tools/scene/scene-browser.cjs', 'vite.config.ts'],
  'tools/smoke/e2e.ts': ['tools/smoke/'],
  'tests/code-tools.test.ts': ['.oxlintrc.json', 'knip.json', 'assets/recipe.json'],
  'tests/asset-packs.test.ts': ['assets/', 'authoring/', 'tools/prepare'],
  'tests/scene-editor.test.ts': ['authoring/scenes/'],
};
function declaredInputs(graph: ModuleGraph, names: readonly string[]) {
  for (const [entry, patterns] of Object.entries(additionalInputs)) {
    if (!(entry in graph.dependencies)) continue;
    graph.dependencies[entry] = [
      ...new Set([
        ...graph.dependencies[entry]!,
        ...names.filter((file) =>
          patterns.some((pattern) => file === pattern || file.startsWith(pattern)),
        ),
      ]),
    ].sort();
  }
  return graph;
}

// Compiler resolution is shared by boundaries, affected tests and evidence identity.
async function moduleGraph(root: string, inputs: InputSnapshot): Promise<ModuleGraph | undefined> {
  if (!inputs.files['tsconfig.json']) return undefined;
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [path.join(root, 'tsconfig.json')] });
    try {
      const project = snapshot.getProject(path.join(root, 'tsconfig.json'));
      if (!project) throw new Error('Cannot open dependency project');
      const dependencies: ModuleGraph['dependencies'] = {},
        unresolved: string[] = [];
      for (const file of Object.keys(inputs.files).filter((f) => /\.[cm]?tsx?$/.test(f))) {
        const source = project.program.getSourceFile(path.join(root, file));
        if (!source) {
          unresolved.push(file);
          continue;
        }
        const edges = new Set<string>();
        inspectImports(project, source, ({ name, resolved, typeOnly }) => {
          if (typeOnly) return;
          if (!name) {
            if (file !== 'tools/smoke/e2e.ts') unresolved.push(file);
            return;
          }
          const internal = resolved && !resolved.replaceAll('\\', '/').includes('/node_modules/');
          let target = internal
            ? path.relative(root, resolved).split(path.sep).join('/')
            : undefined;
          if (!target && name.startsWith('.')) {
            const base = path
              .relative(root, path.resolve(root, path.dirname(file), name))
              .split(path.sep)
              .join('/');
            target = [
              base,
              base + '.ts',
              base + '.tsx',
              base.replace(/\.js$/, '.ts'),
              base + '/index.ts',
            ].find((candidate) => candidate in inputs.files);
            if (!target) {
              unresolved.push(file);
              return;
            }
          }
          if (target) {
            if (target.startsWith('../') || !(target in inputs.files)) unresolved.push(file);
            else edges.add(target);
          }
        });
        dependencies[file] = [...edges].sort();
      }
      return declaredInputs(
        { dependencies, unresolved: [...new Set(unresolved)].sort() },
        Object.keys(inputs.files),
      );
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}
export function dependencyClosure(graph: ModuleGraph, entries: readonly string[]) {
  const files = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const edge of graph.dependencies[file] ?? []) visit(edge);
  };
  entries.forEach(visit);
  return { files, unresolved: graph.unresolved.some((file) => files.has(file)) };
}
