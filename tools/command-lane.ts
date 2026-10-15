import { onExit } from './scope-exit';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
// Top-level operations hold an OS-owned listener for their full command lifetime.
export async function acquireCommandLane(
  options: {
    port?: number;
    name?: string;
    command?: string;
    cwd?: string;
    waitMs?: number;
    signal?: AbortSignal;
    report?: (message: string) => void;
  } = {},
) {
  const name = options.name ?? 'GPU/preparation',
    port = options.port ?? 48158,
    started = Date.now(),
    waitMs = options.waitMs ?? 5 * 60_000;
  const controller = new AbortController(),
    interrupt = () => controller.abort();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let announced = false;
  using _scopeExit1 = onExit(() => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  });
  for (;;) {
    signal.throwIfAborted();
    const sockets = new Set<net.Socket>();
    const owner = {
      pid: process.pid,
      command: options.command ?? name,
      checkout: options.cwd ?? process.cwd(),
      startedAt: Date.now(),
    };
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      socket.end(JSON.stringify(owner));
    });
    const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      server.once('error', resolve);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve(undefined));
    });
    if (!error) {
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      };
      if (signal.aborted) {
        await release();
        signal.throwIfAborted();
      }
      return { port: (server.address() as net.AddressInfo).port, release };
    }
    if (error.code !== 'EADDRINUSE') throw error;
    if (!announced) {
      (options.report ?? console.error)('Waiting for the local ' + name + ' lane on port ' + port);
      announced = true;
    }
    if (Date.now() - started >= waitMs)
      throw new Error(name + ' lane is occupied; no work started');
    await delay(Math.min(250, waitMs - (Date.now() - started)), undefined, { signal });
  }
}
