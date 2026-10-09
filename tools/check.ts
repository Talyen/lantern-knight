import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';

export async function check(ci = false) {
  const phases: [string, string[]][] = [
    ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['lint', ['--import', 'tsx', 'tools/lint.ts', 'js']],
    ['formatting', ['--import', 'tsx', 'tools/format.ts', '--check']],
    ['pure tests', ['--import', 'tsx', 'tools/test.ts']],
    ...(ci
      ? ([
          ['documentation', ['--import', 'tsx', 'tools/check-docs.ts']],
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--ci')) throw new Error('Use check [--ci]');
  check(process.argv.includes('--ci')).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
