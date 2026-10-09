import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contextOwner, contextRoutes, entryLocation, verificationPlan } from './verification-plan';
import { taskBaseline, taskDirectory, snapshot, delta } from './task-state';
import { latestResult, boundedText } from './command-report';
import { testGroups } from './test';
import { scenePreviewPort } from './scene/scene-server';

const briefWords = (text: string, count: number) => {
  const words = text.split(/\s+/);
  return words.slice(0, count).join(' ') + (words.length > count ? '…' : '');
};

export function contextPaths(root: string, paths: string[]) {
  return [
    ...new Set(
      paths.map((name) => {
        if (name.startsWith('--')) throw new Error('Use agent:context [paths...]');
        const relative = path.relative(root, path.resolve(root, name)).split(path.sep).join('/');
        if (
          !relative ||
          relative === '..' ||
          relative.startsWith('../') ||
          path.isAbsolute(relative)
        )
          throw new Error('Context paths must name files/directories inside the checkout');
        return relative;
      }),
    ),
  ];
}
export function taskStartArgs(args: string[], root: string) {
  const [name, ...rest] = args;
  if (
    !name ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name) ||
    (rest.length && (rest[0] !== '--paths' || rest.length < 2))
  )
    throw new Error('Use task:start <short-task-name> [--paths <paths...>]');
  return { name, paths: contextPaths(root, rest.slice(1)) };
}
export async function agentContext(root: string, paths: string[] = []) {
  const explicit = contextPaths(root, paths);
  const current = await snapshot(root),
    task = await taskBaseline(root);
  const changes = task ? delta(task.start, current) : [];
  const scope = explicit.length ? explicit : changes.length ? changes : (task?.paths ?? []);
  const ownersFor = (target: string) =>
    [target, ...Object.keys(current.files).filter((file) => file.startsWith(target + '/'))]
      .map(contextOwner)
      .filter((owner) => owner !== undefined);
  const routes = [...new Set(scope.flatMap(ownersFor))];
  const missing = scope.filter((file) => !ownersFor(file).length);
  const latest = await latestResult(root, current);
  const relevant =
    latest &&
    (!scope.length ||
      latest.inputs.some((file) =>
        scope.some((target) => file === target || file.startsWith(target + '/')),
      ));
  const evidence = !latest
    ? 'not performed or expired'
    : !latest.matching
      ? 'stale; inputs changed'
      : latest.result.outcome === 'failed'
        ? 'failure; no passing claim'
        : latest.result.outcome === 'not-run'
          ? 'not performed (no tests selected)'
          : relevant
            ? latest.result.reused
              ? 'reusable prior passing evidence; selected scope only'
              : 'current passing evidence; selected scope only'
            : 'not performed for this scope';
  const plan = await verificationPlan(root, { prototype: true });
  const suites =
    explicit.length || !changes.length
      ? [
          ...new Set([
            ...routes.flatMap((owner) => owner.suites.map((name) => 'tests/' + name + '.test.ts')),
            ...scope.filter((name) => /^tests\/[^/]+\.test\.ts$/.test(name)),
          ]),
        ].filter((name) => name in current.files)
      : plan.suites;
  const groups = testGroups(suites);
  const directory = await taskDirectory(root);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'context.json');
  const detail = {
    task: task
      ? {
          name: task.name,
          commit: task.commit,
          identity: task.identity,
          inheritedDirty: task.inheritedDirty,
        }
      : null,
    scope,
    scopeSource: explicit.length
      ? 'explicit'
      : changes.length
        ? 'task delta'
        : task?.paths?.length
          ? 'task discovery paths'
          : 'repository map',
    owners: routes.map(({ match: _, ...owner }) => owner),
    unmapped: missing,
    verification: { evidence, latest: latest?.file, suites, groups, plan },
    previewPort: scenePreviewPort(),
  };
  const temporary = file + '.' + randomUUID();
  await fs.writeFile(temporary, JSON.stringify(detail, null, 2) + '\n');
  await fs.rename(temporary, file);
  const lines = [
    task
      ? `Task: ${task.name}; commit ${task.commit?.slice(0, 12) ?? 'unavailable'}; snapshot ${task.identity?.slice(0, 12) ?? 'legacy'}; ${task.inheritedDirty ?? 'unknown'} inherited dirty paths.`
      : 'Task: none; run npm run task:start -- <name> [--paths <paths...>] before editing.',
    `Scope: ${briefWords(boundedText(scope.slice(0, 6).join(', '), 500), 60) || 'repository map; pass paths to agent:context for focused owners/checks'}.`,
    `Evidence: ${evidence}${latest ? '; ' + latest.result.command : ''}. Local only; hosted CI and visual approval separate.`,
    ...(latest
      ? ['Remaining: ' + briefWords(boundedText(latest.result.remaining.join('; '), 260), 35) + '.']
      : []),
    `Preview port: ${detail.previewPort}. Normal finish: npm run check; changed browser interaction: scene:probe or ui:probe.`,
  ];
  let shown = 0;
  for (const route of scope.length
    ? routes
    : contextRoutes.filter((owner) => owner.name !== 'documentation')) {
    const sources = new Map(
      await Promise.all(
        route.entries.map(async (entry) => {
          const file = entry.split('#')[0]!;
          return [
            file,
            await fs.readFile(path.join(root, file), 'utf8').catch(() => undefined),
          ] as const;
        }),
      ),
    );
    const line = `${route.name}: ${route.entries.map((entry) => entryLocation(entry, sources.get(entry.split('#')[0]!)) ?? entry).join(', ')}; ${route.docs.join(', ')}${route.skills?.length ? '; ' + route.skills.join(', ') : ''}.`;
    if (shown === 4 || (lines.join(' ') + ' ' + line).split(/\s+/).length > 320) break;
    lines.push(line);
    shown++;
  }
  if (suites.length)
    lines.push(
      'Focused tests: npm test -- ' +
        briefWords(boundedText(suites.slice(0, 5).join(' '), 400), 60) +
        ` (${groups.pure.length} pure/${groups.assets.length} asset-backed; recommendations do not restrict check selection).`,
    );
  if (missing.length)
    lines.push(
      `${missing.length} paths lack a discovery owner; verification retains conservative fallback.`,
    );
  lines.push(
    'Cross-boundary contracts: .agents/skills/architect/SKILL.md. Artwork: assets:inspect for bounded details; assets:dev for prototype preparation; publication explicit.',
  );
  const omitted =
    Math.max(0, (scope.length ? routes.length : contextRoutes.length - 1) - shown) +
    Math.max(0, scope.length - 6) +
    Math.max(0, suites.length - 5);
  lines.push(
    `${omitted} scope/owner/test entries omitted. Details: ${file}${latest ? '; evidence: ' + latest.file : ''}`,
  );
  return { text: lines.join('\n'), file, detail };
}
