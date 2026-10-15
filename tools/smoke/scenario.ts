import { onAsyncExit } from '../scope-exit';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { smokeLaunch } from './smoke-launch';

type Run = Awaited<ReturnType<typeof smokeLaunch>>;
type Diagnostic = Pick<Run, 'errors' | 'writeReport' | 'close'> &
  Partial<Pick<Run, 'page' | 'output'>>;

// A scenario owns its diagnostics until reporting and shutdown both settle.
// Failure reporting and teardown must never replace the original assertion.
export async function withDiagnostic<T extends Diagnostic>(
  run: T,
  work: (run: T, details: Record<string, unknown>) => Promise<void>,
) {
  await using _close = onAsyncExit(() => run.close());
  const details: Record<string, unknown> = {};
  const writeReport = run.writeReport.bind(run);
  run.writeReport = (file, value) => {
    if (file !== 'failure.json') assert.deepEqual(run.errors, []);
    return writeReport(file, value);
  };
  try {
    await work(run, details);
    assert.deepEqual(run.errors, []);
    if (run.output) await fs.rm(path.join(run.output, 'failure.json'), { force: true });
  } catch (error) {
    if (run.page && run.output)
      await run.page.screenshot({ path: path.join(run.output, 'failure.png') }).catch(() => {});
    try {
      await run.writeReport('failure.json', {
        ...details,
        error: String(error),
        errors: run.errors,
      });
    } catch (reportError) {
      throw new AggregateError([error, reportError], 'Diagnostic reporting failed', {
        cause: error,
      });
    }
    throw error;
  }
}

export async function scenario(
  dev: boolean,
  flags: string[],
  work: (
    run: Run & { capturePage(name: string): Promise<void> },
    details: Record<string, unknown>,
  ) => Promise<void>,
  options: Omit<NonNullable<Parameters<typeof smokeLaunch>[2]>, 'flags'> = {},
  args: string[] = [],
) {
  const run = await smokeLaunch(dev, args, { ...options, flags });
  return withDiagnostic(
    Object.assign(run, {
      async capturePage(name: string) {
        if (run.capture) await run.page.screenshot({ path: path.join(run.output, name + '.png') });
      },
    }),
    work,
  );
}
