import { onAsyncExit } from './scope-exit';
import { execFileSync, spawn } from 'node:child_process';
// Each invocation owns one process group; cancellation asks its command to close first.
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    // Output resets this deadline; the absolute timeout, if set, remains independent.
    idleTimeoutMs?: number;
    shutdownGraceMs?: number;
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
    stdio:
      options.output || options.idleTimeoutMs !== undefined
        ? ['ignore', 'pipe', 'pipe']
        : 'inherit',
  });
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
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return;
      if (code === 'EPERM' && (child.exitCode !== null || child.signalCode !== null)) {
        // macOS can refuse signals to an orphaned group of zombies. Only
        // tolerate that after the command exits and no live group member remains.
        try {
          const groups = execFileSync('ps', ['-axo', 'pgid=,stat='], {
            encoding: 'utf8',
            timeout: 5000,
          });
          const live = groups.split('\n').some((line) => {
            const [group, state] = line.trim().split(/\s+/);
            return Number(group) === child.pid && state && !state.startsWith('Z');
          });
          if (!live) return;
        } catch {
          // An unavailable process inventory cannot establish safe retirement.
        }
      }
      throw error;
    }
  };
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = reason;
    kill('SIGTERM');
    force = setTimeout(() => kill('SIGKILL'), options.shutdownGraceMs ?? 5000);
    force.unref();
  };
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const activity = () => {
    clearTimeout(idleTimer);
    if (!stopped && options.idleTimeoutMs !== undefined)
      idleTimer = setTimeout(() => stop('stalled without output'), options.idleTimeoutMs);
  };
  let outputFailure: { error: unknown } | undefined;
  const output = (stream: NodeJS.WriteStream, chunk: Buffer) => {
    activity();
    if (outputFailure) return;
    try {
      if (options.output) options.output(chunk);
      else stream.write(chunk);
    } catch (error) {
      outputFailure = { error };
      stop('output failed');
    }
  };
  child.stdout?.on('data', (chunk: Buffer) => output(process.stdout, chunk));
  child.stderr?.on('data', (chunk: Buffer) => output(process.stderr, chunk));
  activity();
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
  await using _scopeExit1 = onAsyncExit(async () => {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    clearTimeout(force);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    options.signal?.removeEventListener('abort', abort);
    // Remaining owned children must not keep a dead command's output handles alive.
    if (grouped) kill('SIGKILL');
    await Promise.all(cleanup);
    child.stdout?.destroy();
    child.stderr?.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 && !stopped
        ? resolve()
        : reject(
            outputFailure
              ? outputFailure.error
              : new Error(`${command} ${stopped ?? `exited ${code ?? signal}`}`),
          ),
    );
  });
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
