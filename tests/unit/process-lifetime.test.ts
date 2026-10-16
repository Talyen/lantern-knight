import { withDiagnostic } from '../../tools/smoke/scenario';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../../tools/run-process';
test('progress renews the stall deadline, but silence and absolute deadlines still stop commands', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let updates = 0;
  await assert.rejects(
    runProcess(process.execPath, ['-e', `setInterval(()=>console.log('progress'),10);`], {
      cwd: process.cwd(),
      idleTimeoutMs: 500,
      signal: controller.signal,
      output: () => {
        t.mock.timers.tick(400);
        if (++updates === 8) controller.abort();
      },
    }),
    /cancelled/,
  );
  assert.equal(updates, 8);
  await assert.rejects(
    runProcess(
      process.execPath,
      ['-e', `console.log('opening fixture.zip'); setInterval(()=>{},1000);`],
      {
        cwd: process.cwd(),
        idleTimeoutMs: 500,
        output: () => t.mock.timers.tick(500),
      },
    ),
    /stalled without output/,
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', `setInterval(()=>console.log('progress'),10);`], {
      cwd: process.cwd(),
      timeoutMs: 700,
      idleTimeoutMs: 500,
      output: () => t.mock.timers.tick(400),
    }),
    /deadline exceeded/,
  );
});
for (const code of [0, 7])
  test(
    `cleanup tolerates an unsignalable retired group without changing command exit ${code}`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const kill = process.kill.bind(process);
      t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
        if (pid < 0 && signal === 'SIGKILL')
          throw Object.assign(new Error('retired process group'), { code: 'EPERM' });
        return kill(pid, signal);
      });
      const run = runProcess(process.execPath, ['-e', `process.exit(${code})`], {
        cwd: process.cwd(),
        output: () => {},
      });
      if (code) await assert.rejects(run, /exited 7/);
      else await run;
    },
  );

test(
  'cleanup still reports permission failures for a live owned descendant',
  { skip: process.platform === 'win32' },
  async (t) => {
    const kill = process.kill.bind(process);
    let group = 0;
    t.after(() => {
      if (group) {
        try {
          kill(-group, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
    });
    t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0 && signal === 'SIGKILL')
        throw Object.assign(new Error('live process group denied'), { code: 'EPERM' });
      return kill(pid, signal);
    });
    const run = runProcess(
      process.execPath,
      [
        '-e',
        `
    require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'}).unref();
    console.log(process.pid);
  `,
      ],
      {
        cwd: process.cwd(),
        output: (chunk) => {
          group = Number(chunk.toString().trim());
        },
      },
    );
    await assert.rejects(run, /live process group denied/);
    assert.ok(group > 0);
  },
);

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
