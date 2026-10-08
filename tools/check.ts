import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AssetCache } from './assets/cache';
import { verificationIdentity, requireStableInputs } from './verification';

export async function runChecks(
  root: string,
  run: (name: string, args: string[]) => Promise<void>,
  local = false,
) {
  const before = await verificationIdentity(root),
    steps: {
      name: string;
      status: 'passed' | 'failed' | 'skipped';
      reason?: string;
    }[] = [];
  const commands: [string, string[]][] = [
    ['typecheck', ['run', 'typecheck']],
    ['repository', ['run', 'repo:check']],
    ['architecture', ['run', 'architecture:check']],
    ['documentation', ['run', 'docs:check']],
    ['formatting', ['run', 'format:check']],
    ['tests', ['test', ...(local ? ['--', '--local'] : [])]],
    ['assets', ['run', 'assets:check', ...(local ? ['--', '--local'] : [])]],
    ['whitespace', []],
  ];
  let failed = false;
  for (const [name, args] of commands) {
    if (failed) {
      steps.push({ name, status: 'skipped', reason: 'earlier check failed' });
      continue;
    }
    try {
      await run(name, args);
      steps.push({ name, status: 'passed' });
    } catch (error) {
      steps.push({ name, status: 'failed', reason: String(error) });
      failed = true;
    }
  }
  try {
    await requireStableInputs(root, before);
    steps.push({ name: 'source stability', status: 'passed' });
  } catch (error) {
    steps.push({
      name: 'source stability',
      status: 'failed',
      reason: String(error),
    });
    failed = true;
  }
  return { source: before, steps, passed: !failed };
}
async function main() {
  await (await import('./task-runner')).managedTask('check', process.argv.slice(2));
}
export async function check(
  root: string,
  args: string[],
  execute: (name: string, args: string[], output: (chunk: Buffer) => void) => Promise<void>,
) {
  const cache = new AssetCache(),
    held = await cache.lease('diagnostics-' + randomUUID(), 8 * 1024 * 1024);
  let log = '',
    current = '';
  try {
    const result = await runChecks(
      root,
      async (name, args) => {
        current = name;
        const started = performance.now();
        console.log(`Checking ${name}…`);
        let output = '';
        try {
          await execute(name, args, (chunk) => {
            output = (output + chunk.toString()).slice(-1024 * 1024);
          });
          if (name === 'tests') {
            const totals = output
              .split('\n')
              .find((line) => /^\d+ suites?; \d+ checks passed; \d+ failed\.$/.test(line));
            if (totals) console.log(totals);
          }
        } catch (error) {
          console.error(output.slice(-4000));
          throw error;
        } finally {
          console.log(`${name}: ${Math.round(performance.now() - started)}ms.`);
          log = (log + `\n${name}\n${output}`).slice(-4 * 1024 * 1024);
        }
      },
      args.includes('--local'),
    );
    console.log(
      result.steps
        .map(
          (step) =>
            `${step.status.toUpperCase()}: ${step.name}${step.reason ? ' — ' + step.reason : ''}`,
        )
        .join('\n'),
    );
    console.log('Local evidence only; hosted CI and visible playtesting have separate ownership.');
    if (!result.passed) {
      await fs.writeFile(path.join(held.root, 'check.json'), JSON.stringify(result, null, 2));
      await fs.writeFile(path.join(held.root, 'check.log'), log);
      console.error('Failure diagnostics: ' + held.root);
      throw new Error('Regular checks failed');
    } else await fs.rm(held.root, { recursive: true, force: true });
  } catch (error) {
    await fs.writeFile(path.join(held.root, 'check.log'), `${current}\n${log}\n${String(error)}`);
    console.error('Failure diagnostics: ' + held.root);
    throw error;
  } finally {
    await held.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
