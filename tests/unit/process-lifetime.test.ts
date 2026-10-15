import { withDiagnostic } from '../../tools/smoke/scenario';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../../tools/run-process';
test('cancellation terminates the owned process tree and does not hold the caller open', async () => {
  const controller = new AbortController();
  let output = '';
  const run = runProcess(
    process.execPath,
    [
      '-e',
      // Reap the child before the parent exits. Killing an orphaned zombie group can
      // return EPERM on macOS; the parent never sends a signal to its child itself.
      `const {spawn}=require('node:child_process');
       const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
       const timer=setInterval(()=>{},1000);
       process.on('SIGTERM',()=>{
         clearInterval(timer);
         if(child.exitCode!==null || child.signalCode!==null) process.exit(0);
         else child.once('exit',()=>process.exit(0));
       });
       console.log(child.pid);`,
    ],
    {
      cwd: process.cwd(),
      signal: controller.signal,
      output: (chunk) => {
        output += chunk.toString();
      },
    },
  );
  const deadline = Date.now() + 5000;
  while (!Number(output.trim())) {
    if (Date.now() > deadline) throw new Error('Child did not start');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  await assert.rejects(run, /cancelled/);
  const pid = Number(output.trim());
  for (let n = 0; n < 100; n++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Owned child survived cancellation');
});

test('a short shutdown grace bounds cancellation of an uncooperative owned process', async () => {
  const controller = new AbortController();
  let ready = false;
  const run = runProcess(
    process.execPath,
    ['-e', `process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);`],
    {
      cwd: process.cwd(),
      signal: controller.signal,
      shutdownGraceMs: 50,
      output: () => {
        ready = true;
      },
    },
  );
  const deadline = Date.now() + 5000;
  while (!ready) {
    if (Date.now() > deadline) {
      controller.abort();
      await run.catch(() => {});
      assert.fail('Owned process did not start');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const started = Date.now();
  controller.abort();
  await assert.rejects(run, /cancelled/);
  assert.ok(
    Date.now() - started < 3000,
    'Custom shutdown grace must not wait the default five seconds',
  );
});

test('diagnostic shutdown retains operation and report failures even if cleanup fails', async () => {
  const [work, report, close] = ['work', 'report', 'close'].map((message) => new Error(message));
  const calls: string[] = [];
  await assert.rejects(
    withDiagnostic(
      {
        errors: [],
        writeReport: async () => {
          calls.push('report');
          throw report;
        },
        close: async () => {
          await Promise.resolve();
          calls.push('close');
          throw close;
        },
      },
      async () => {
        calls.push('work');
        throw work;
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof SuppressedError);
      assert.equal(error.error, close);
      assert.ok(error.suppressed instanceof AggregateError);
      assert.equal(error.suppressed.cause, work);
      assert.deepEqual(error.suppressed.errors, [work, report]);
      return true;
    },
  );
  assert.deepEqual(calls, ['work', 'report', 'close']);
});
