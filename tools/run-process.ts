import { spawn } from 'node:child_process';
// Each invocation owns one process group; cancellation asks its command to close first.
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    output?: (chunk: Buffer) => void;
    signal?: AbortSignal;
  },
) {
  options.signal?.throwIfAborted();
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: grouped,
    stdio: options.output ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  child.stdout?.on('data', options.output!);
  child.stderr?.on('data', options.output!);
  let stopped: string | undefined, force: ReturnType<typeof setTimeout> | undefined;
  const cleanup: Promise<void>[] = [];
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    if (!grouped) {
      cleanup.push(
        new Promise<void>((resolve) => {
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
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = reason;
    kill('SIGTERM');
    force = setTimeout(() => kill('SIGKILL'), 5000);
    force.unref();
  };
  const interrupt = () => stop('interrupted'),
    terminate = () => stop('terminated'),
    abort = () => stop('cancelled');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => stop('deadline exceeded'), options.timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        code === 0 && !stopped
          ? resolve()
          : reject(new Error(`${command} ${stopped ?? `exited ${code ?? signal}`}`)),
      );
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    options.signal?.removeEventListener('abort', abort);
    // Remaining owned children must not keep a dead command's output handles alive.
    if (grouped) kill('SIGKILL');
    await Promise.all(cleanup);
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}

export async function untilInterrupted() {
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
