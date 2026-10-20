import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './run-process';

// Conservative relative costs from hosted software-WebGL runs. Exact-pixel
// journeys stay expensive; UI/state proofs now use much smaller framebuffers.
const costs: Readonly<Record<string, number>> = {
  'editor-asset-review.spec.ts': 90,
  'editor-ground.spec.ts': 90,
  'editor.spec.ts': 45,
  'editor-adventure.spec.ts': 30,
  'editor-bugs.spec.ts': 30,
  'editor-campfires.spec.ts': 30,
  'editor-regressions.spec.ts': 20,
  'scene-lifetime.spec.ts': 10,
  'scene-movement.spec.ts': 30,
  'scene-combat-aim.spec.ts': 30,
  'scene.spec.ts': 60,
  'audio.spec.ts': 60,
  'effects.spec.ts': 60,
  'editor-game-view.spec.ts': 120,
  'editor-contact.spec.ts': 90,
  'scene-motion-blur.spec.ts': 180,
  'scene-shadow-batching.spec.ts': 90,
  'scene-combat-feedback.spec.ts': 120,
  'scene-oracle.spec.ts': 60,
};
type Suite = {
  title: string;
  file: string;
  line: number;
  specs: { file: string; title: string }[];
  suites?: Suite[];
};
export function browserShards(suites: Suite[], count: number) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid CI shard count');
  const tests: { name: string; cost: number }[] = [];
  function visit(suite: Suite, parents: string[]) {
    const titles = suite.line === 0 ? parents : [...parents, suite.title];
    for (const spec of suite.specs)
      tests.push({
        name: [spec.file, ...titles, spec.title].join(' › '),
        cost: costs[spec.file] ?? 5,
      });
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  suites.forEach((suite) => visit(suite, []));
  if (!tests.length || new Set(tests.map((t) => t.name)).size !== tests.length)
    throw new Error('CI discovery must contain unique runnable tests');
  const shards = Array.from({ length: count }, () => ({ cost: 0, tests: [] as string[] }));
  for (const test of tests.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))) {
    const shard = shards.reduce((a, b) => (b.cost < a.cost ? b : a));
    shard.cost += test.cost;
    shard.tests.push(test.name);
  }
  return shards;
}
export async function ciBrowserShard(args: string[], shard: string, root: string) {
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const current = Number(match?.[1]),
    count = Number(match?.[2]);
  if (!match || current < 1 || current > count || count > 64)
    throw new Error('Use --ci-shard=1/N through N/N, with N <= 64');
  const directory = path.join(root, '.cache');
  await fs.mkdir(directory, { recursive: true });
  const listing = path.join(directory, `ci-discovery-${current}.json`);
  let diagnostic = '';
  try {
    await runProcess(
      process.execPath,
      [
        '--import',
        'tsx',
        'node_modules/@playwright/test/cli.js',
        'test',
        ...args.filter((a) => a !== '--list'),
        '--list',
        '--reporter=json',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_FILE: listing,
        },
        timeoutMs: 60_000,
        output: (chunk) => {
          diagnostic = (diagnostic + chunk.toString()).slice(-65536);
        },
      },
    );
  } catch (error) {
    console.error(diagnostic);
    throw error;
  }
  const plan = browserShards(JSON.parse(await fs.readFile(listing, 'utf8')).suites, count);
  const selected = plan[current - 1]!;
  if (!selected.tests.length) throw new Error('Empty CI shard; reduce the shard count');
  const file = path.join(directory, `ci-shard-${current}.txt`);
  await fs.writeFile(file, selected.tests.join('\n') + '\n');
  console.log(`CI shard ${shard}: ${selected.tests.length} tests; relative cost ${selected.cost}`);
  return [...args, '--test-list', file];
}
