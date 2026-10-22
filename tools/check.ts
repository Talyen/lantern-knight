import { runCli } from './cli';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { changedFiles, comparisonFiles } from './changed-files';
import { documentationOnly } from './coverage-policy';
import { parseArgs } from 'node:util';

async function check(ci = false, base?: string) {
  const files = base
    ? changedFiles(projectRoot, base)
    : ci && !process.env.LANTERN_CI_BASE
      ? undefined
      : comparisonFiles(projectRoot, ci ? process.env.LANTERN_CI_BASE : undefined);
  const prose = documentationOnly(files);
  console.log(prose ? 'Prose-only changes: checking documentation.' : 'Checking source changes.');
  const phases: [string, string[]][] = [
    ...(!prose
      ? ([
          ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
          ['lint', ['--import', 'tsx', 'tools/lint.ts', 'js']],
          ['formatting', ['--import', 'tsx', 'tools/format.ts', '--check']],
          ['pure tests', ['--import', 'tsx', 'tools/test.ts', ...(ci ? ['--full'] : [])]],
        ] as [string, string[]][])
      : []),
    ...(prose || ci || files?.some((file) => file.endsWith('.md'))
      ? ([['documentation', ['--import', 'tsx', 'tools/check-docs.ts']]] as [string, string[]][])
      : []),
    ...(ci && !prose
      ? ([
          ['repository', ['--import', 'tsx', 'tools/check-repository.ts']],
          ['architecture', ['--import', 'tsx', 'tools/check-architecture.ts']],
          ['unused code', ['--import', 'tsx', 'tools/lint.ts', 'knip']],
        ] as [string, string[]][])
      : []),
  ];
  const started = performance.now();
  for (const [name, args] of phases) {
    const start = performance.now();
    let log = '';
    try {
      await runProcess(process.execPath, args, {
        cwd: projectRoot,
        timeoutMs: 5 * 60_000,
        output: (chunk) => {
          log = (log + chunk.toString()).slice(-65536);
        },
      });
    } catch (error) {
      console.error(log);
      throw error;
    }
    const summary = log
      .split('\n')
      .filter((line) => /ℹ (tests|pass|fail) /.test(line))
      .join('; ');
    console.log(
      `${name}: passed in ${Math.round(performance.now() - start)}ms${summary ? '; ' + summary : ''}`,
    );
  }
  console.log(`PASS: ${phases.length} fresh phases; ${Math.round(performance.now() - started)}ms.`);
}
runCli(import.meta.url, () => {
  const { values } = parseArgs({ options: { ci: { type: 'boolean' }, base: { type: 'string' } } });
  return check(values.ci, values.base);
});
