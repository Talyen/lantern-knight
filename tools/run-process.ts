import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Terminate only this invocation's process tree, including npm/test children.
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    output?: (chunk: Buffer) => void;
  },
) {
  const env = options.env ?? process.env,
    grouped = process.platform !== 'win32' && env.LANTERN_MANAGED_TREE !== '1';
  const deadline = Number(env.LANTERN_EXECUTION_DEADLINE),
    remaining = Number.isFinite(deadline) && deadline > 0 ? deadline - Date.now() : Infinity,
    timeoutMs = Math.min(options.timeoutMs ?? Infinity, remaining);
  if (timeoutMs <= 0) throw new Error('Aggregate execution deadline exceeded before launch');
  // Nested runners stay in the supervisor's group so an outer cancellation
  // cannot strand a separately detached compiler/browser/preparation process.
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...env, LANTERN_MANAGED_TREE: '1' },
    detached: grouped,
    stdio: options.output ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (options.output) {
    child.stdout!.on('data', options.output);
    child.stderr!.on('data', options.output);
  }
  let stopped: string | undefined, force: ReturnType<typeof setTimeout> | undefined;
  let descendants: number[] = [];
  const cleanup: Promise<void>[] = [];
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      cleanup.push(
        new Promise((resolve) => {
          const task = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          task.once('error', () => resolve());
          task.once('close', () => resolve());
        }),
      );
      return;
    }
    for (const pid of grouped ? [-child.pid] : [...descendants, child.pid])
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
  };
  const ownedDescendants = () => {
    if (grouped || process.platform === 'win32' || !child.pid) return;
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((row) => row.trim().split(/\s+/).map(Number));
    const owned = new Set([child.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, parent] of rows)
        if (pid && parent && owned.has(parent) && !owned.has(pid)) {
          owned.add(pid);
          changed = true;
        }
    }
    descendants = [...owned].filter((pid) => pid !== child.pid).reverse();
  };
  const stop = (reason: string, signal: NodeJS.Signals) => {
    if (stopped) return;
    stopped = reason;
    ownedDescendants();
    kill(signal);
    force = setTimeout(() => kill('SIGKILL'), 5000);
  };
  const interrupt = () => stop('interrupted', 'SIGINT'),
    terminate = () => stop('terminated', 'SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const timer = Number.isFinite(timeoutMs)
    ? setTimeout(() => stop('deadline exceeded', 'SIGTERM'), timeoutMs)
    : undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) =>
        code === 0 && !stopped
          ? resolve()
          : reject(new Error(`${command} ${stopped ?? `exited ${code ?? signal}`}`)),
      );
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
    try {
      if (grouped || stopped) kill('SIGKILL');
      await Promise.all(cleanup);
      if (process.platform !== 'win32' && child.pid) {
        const targets = grouped ? [-child.pid] : stopped ? descendants : [];
        for (const pid of targets) {
          const deadline = Date.now() + 5000;
          for (;;) {
            try {
              process.kill(pid, 0);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') break;
              throw error;
            }
            if (Date.now() >= deadline) throw new Error('Owned child cleanup did not finish');
            await delay(10);
          }
        }
      }
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  }
}
