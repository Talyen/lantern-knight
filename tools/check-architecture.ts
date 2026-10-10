import fs from 'node:fs/promises';
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { inspectImports } from './import-edges';

// These rules protect existing owners, including type imports and re-exports.
// Three.js math and the current core/content/asset relationships remain legal.
function importFinding(file: string, target: string) {
  if (!file.startsWith('src/')) return;
  if (
    (file.startsWith('src/core/') || file === 'src/content/world.ts') &&
    /^src\/content\/(?:game-content|world-art|world-visuals|scene-document|scene-v1|scenery-presets|visuals|asset-catalog|graveyard-scene|crypt-scene)/.test(
      target,
    )
  )
    return 'gameplay models require an explicit registry, without production scene or visual composition imports';
  if (
    file.startsWith('src/presentation/') &&
    /^src\/content\/(?:world-art|scene-document)(?:\.|$)/.test(target)
  )
    return 'presentation receives resolved world-visuals; authored scene parsing belongs to content and editor owners';
  if (
    /^(?:electron|tools|tests)\//.test(target) ||
    target === 'electron' ||
    target.startsWith('node:') ||
    builtinModules.includes(target) ||
    target.startsWith('../') ||
    path.isAbsolute(target)
  )
    return 'runtime source must use its browser/Bridge seam, not desktop or tooling imports';
  if (
    /^src\/(?:core|content|assets)\//.test(file) &&
    target.startsWith('src/') &&
    !/^src\/(?:core|content|assets)\//.test(target)
  )
    return 'core, content and assets must not depend on application, presentation or developer entry points';
}
async function checkArchitecture(root: string, files: string[]) {
  const api = new API({ cwd: root }),
    findings: string[] = [];
  try {
    const snapshot = api.updateSnapshot({ openProjects: [path.join(root, 'tsconfig.json')] }),
      project = snapshot.getProject(path.join(root, 'tsconfig.json'));
    if (!project) throw new Error('Architecture checker could not open tsconfig.json');
    for (const file of files.filter((f) => f.startsWith('src/') && /\.[cm]?tsx?$/.test(f))) {
      try {
        await fs.access(path.join(root, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const source = project.program.getSourceFile(path.join(root, file));
      if (!source) throw new Error(`Runtime file is outside tsconfig: ${file}`);
      inspectImports(project, source, ({ name, resolved, line }) => {
        if (!name) {
          findings.push(
            `${file}:${line}: module imports must have a literal target for boundary validation`,
          );
          return;
        }
        const target =
          resolved && !resolved.replaceAll('\\', '/').includes('/node_modules/')
            ? path.relative(root, resolved).split(path.sep).join('/')
            : name.startsWith('.')
              ? path
                  .relative(root, path.resolve(root, path.dirname(file), name))
                  .split(path.sep)
                  .join('/')
              : name;
        const finding = importFinding(file, target);
        if (finding) findings.push(`${file}:${line}: ${name}: ${finding}`);
      });
    }
    const edges = new Map<string, string[]>();
    for (const file of files.filter((file) => file.startsWith('tools/') && /\.ts$/.test(file))) {
      const source = project.program.getSourceFile(path.join(root, file));
      if (!source) continue;
      const targets: string[] = [];
      inspectImports(project, source, ({ resolved, typeOnly }) => {
        if (typeOnly || !resolved || resolved.replaceAll('\\', '/').includes('/node_modules/'))
          return;
        const target = path.relative(root, resolved).split(path.sep).join('/');
        if (target.startsWith('tools/')) targets.push(target);
      });
      edges.set(file, targets);
    }
    const visited = new Set<string>(),
      active: string[] = [];
    const visit = (file: string) => {
      if (active.includes(file)) {
        findings.push(
          'Tool dependency cycle: ' + [...active.slice(active.indexOf(file)), file].join(' → '),
        );
        return;
      }
      if (visited.has(file)) return;
      active.push(file);
      for (const target of edges.get(file) ?? []) visit(target);
      active.pop();
      visited.add(file);
    };
    for (const file of edges.keys()) visit(file);
    snapshot.dispose();
    return findings;
  } finally {
    api.close();
  }
}
async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url)),
    files = execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
      ],
      { cwd: root, encoding: 'utf8' },
    ).split('\0');
  const findings = await checkArchitecture(root, [...new Set(files)]);
  if (findings.length)
    throw new Error(
      `${findings.length} import boundary violations:\n${findings.slice(0, 10).join('\n')}`,
    );
  console.log(
    'PASS: runtime import boundaries and acyclic tooling dependencies, including literal dynamic imports.',
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
