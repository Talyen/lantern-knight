import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireCommandLane } from '../tools/command-lane';
import { runProcess } from '../tools/run-process';

const moduleURL = new URL('../tools/command-lane.ts', import.meta.url).href;
function child(source: string, cwd: string, env = process.env) {
  const processChild = spawn(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', source],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  processChild.stdout.on('data', (chunk) => (output += chunk));
  processChild.stderr.on('data', (chunk) => (output += chunk));
  const done = new Promise<void>((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('close', (code) => (code === 0 ? resolve() : reject(new Error(output))));
  });
  const wait = async (pattern: RegExp) => {
    const end = Date.now() + 5000;
    while (!pattern.test(output)) {
      if (Date.now() > end) throw new Error('Child did not report: ' + output);
      await delay(10);
    }
  };
  return {
    process: processChild,
    done,
    wait,
    get output() {
      return output;
    },
  };
}

test('three independent command processes across checkouts wait before work and never overlap', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-lane-')),
    lane = await acquireCommandLane({ port: 0, command: 'fixture owner', cwd: root }),
    children: ReturnType<typeof child>[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const cwd = path.join(root, String(i));
      await fs.mkdir(cwd);
      children.push(
        child(
          `import {acquireCommandLane} from ${JSON.stringify(moduleURL)};import fs from 'node:fs/promises';const lane=await acquireCommandLane({port:${lane.port},waitMs:5000});try{const nested=await acquireCommandLane({port:${lane.port},env:lane.env,waitMs:0});await nested.release();await fs.appendFile(${JSON.stringify(path.join(root, 'events'))},'start ${i}\\n');await new Promise(r=>setTimeout(r,80));await fs.appendFile(${JSON.stringify(path.join(root, 'events'))},'end ${i}\\n');}finally{await lane.release();}`,
          cwd,
        ),
      );
    }
    await Promise.all(children.map((c) => c.wait(/Waiting for Lantern command: fixture owner/)));
    assert.ok(
      children.every((c) => c.output.includes(root) && c.output.includes('PID ' + process.pid)),
    );
    await assert.rejects(fs.stat(path.join(root, 'events')), { code: 'ENOENT' });
    await lane.release();
    await Promise.all(children.map((c) => c.done));
    const events = (await fs.readFile(path.join(root, 'events'), 'utf8')).trim().split('\n');
    assert.equal(events.length, 6);
    for (let i = 0; i < 6; i += 2) {
      assert.match(events[i]!, /^start /);
      assert.equal(events[i + 1], events[i]!.replace('start', 'end'));
    }
  } finally {
    await lane.release();
    for (const c of children) c.process.kill();
    await Promise.allSettled(children.map((c) => c.done));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('lane credentials require a live owner; bounded and aborted waits perform no work', async () => {
  const lane = await acquireCommandLane({ port: 0 }),
    port = lane.port;
  const original = lane.env.LANTERN_COMMAND_LANE!;
  try {
    const nested = await acquireCommandLane({ port, env: lane.env, waitMs: 0 });
    await nested.release();
    await assert.rejects(
      acquireCommandLane({
        port,
        env: { LANTERN_COMMAND_LANE: JSON.stringify({ port, token: 'wrong' }) },
        waitMs: 60,
        report: () => {},
      }),
      /wait deadline exceeded/,
    );
    const controller = new AbortController();
    const wait = acquireCommandLane({
      port,
      signal: controller.signal,
      report: () => controller.abort(new Error('cancel queued command')),
    });
    await assert.rejects(wait, /cancel queued command/);
    const cancelled = new AbortController();
    cancelled.abort(new Error('already cancelled'));
    await assert.rejects(
      acquireCommandLane({ port, signal: cancelled.signal, env: lane.env }),
      /already cancelled/,
    );
  } finally {
    await lane.release();
  }
  const next = await acquireCommandLane({ port, env: lane.env, waitMs: 0 });
  assert.notEqual(next.env.LANTERN_COMMAND_LANE, original);
  await next.release();
  await next.release();
});

test('terminating a lane owner releases admission without a stale credential bypass', async () => {
  const reserve = await acquireCommandLane({ port: 0 }),
    port = reserve.port;
  await reserve.release();
  const owner = child(
    `import {acquireCommandLane} from ${JSON.stringify(moduleURL)};await acquireCommandLane({port:${port}});console.log('owned');setInterval(()=>{},1000);`,
    process.cwd(),
  );
  try {
    await owner.wait(/owned/);
    owner.process.kill('SIGKILL');
    await assert.rejects(owner.done);
    const next = await acquireCommandLane({ port, waitMs: 500 });
    await next.release();
  } finally {
    owner.process.kill('SIGKILL');
    await Promise.allSettled([owner.done]);
  }
});

test('managed cancellation reaps a stubborn descendant before releasing its lane', async () => {
  const lane = await acquireCommandLane({ port: 0 });
  let output = '';
  try {
    const env = { ...lane.env };
    delete env.LANTERN_MANAGED_TREE;
    await assert.rejects(
      runProcess(
        process.execPath,
        [
          '-e',
          `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(child.pid);process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`,
        ],
        { cwd: process.cwd(), env, timeoutMs: 500, output: (chunk) => (output += chunk) },
      ),
      /deadline exceeded/,
    );
    const pid = Number(output.trim());
    assert.ok(pid > 0);
    // SIGKILL is issued before runProcess returns; give the OS time to reap.
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) {
      try {
        process.kill(pid, 0);
        await delay(10);
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, 'owned grandchild survived cancellation');
  } finally {
    await lane.release();
  }
  const next = await acquireCommandLane({ port: lane.port, waitMs: 0 });
  await next.release();
});

test('process failure retains its original cause when owned cleanup also fails', async () => {
  if (process.platform === 'win32') return; // Windows uses taskkill rather than process groups.
  const descriptor = Object.getOwnPropertyDescriptor(process, 'kill')!,
    cleanup = new Error('cleanup permission denied'),
    signals = ['SIGINT', 'SIGTERM'] as const,
    listeners = signals.map((signal) => process.listenerCount(signal));
  try {
    Object.defineProperty(process, 'kill', {
      ...descriptor,
      value: () => {
        throw cleanup;
      },
    });
    const env = { ...process.env };
    delete env.LANTERN_MANAGED_TREE;
    await assert.rejects(
      runProcess(process.execPath, ['-e', 'process.exit(7)'], {
        cwd: process.cwd(),
        env,
        timeoutMs: 2000,
        output: () => {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.errors[0].message, /exited 7/);
        assert.equal(error.errors[1], cleanup);
        return true;
      },
    );
    assert.deepEqual(
      signals.map((signal) => process.listenerCount(signal)),
      listeners,
    );
  } finally {
    Object.defineProperty(process, 'kill', descriptor);
  }
});
