import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const credentialName = 'LANTERN_COMMAND_LANE';
type Owner = { pid: number; command: string; checkout: string; startedAt: number };
type Credential = { port: number; token: string };
type Reply = { owner: Owner; borrowed: boolean };
export function withoutCommandLane(env: NodeJS.ProcessEnv) {
  const copy = { ...env };
  delete copy[credentialName];
  return copy;
}

async function inspectOwner(port: number, token?: string): Promise<Reply | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let data = '',
      done = false;
    const finish = (reply?: Reply) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(reply);
    };
    socket.setTimeout(1000, () => finish());
    socket.on('error', () => finish());
    socket.on('end', () => finish());
    socket.on('connect', () => socket.write(JSON.stringify({ token }) + '\n'));
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 8192) return finish();
      if (!data.includes('\n')) return;
      try {
        const reply = JSON.parse(data.split('\n')[0]!);
        if (
          typeof reply.borrowed === 'boolean' &&
          Number.isInteger(reply.owner?.pid) &&
          typeof reply.owner.command === 'string' &&
          typeof reply.owner.checkout === 'string' &&
          Number.isFinite(reply.owner.startedAt)
        )
          finish(reply);
        else finish();
      } catch {
        finish();
      }
    });
  });
}

// The listener is the lease: no stale files, and credentials are checked live.
export async function acquireCommandLane(
  options: {
    port?: number;
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    waitMs?: number;
    signal?: AbortSignal;
    report?: (message: string) => void;
  } = {},
) {
  const port = options.port ?? 48158,
    env = options.env ?? process.env,
    waitMs = options.waitMs ?? 5 * 60 * 1000;
  const controller = new AbortController(),
    interrupt = () => controller.abort(new Error('Lantern command wait interrupted'));
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const started = Date.now();
  let announced = false;
  try {
    let inherited: Credential | undefined;
    try {
      const value = JSON.parse(env[credentialName] ?? 'null');
      if (value?.port === port && typeof value.token === 'string') inherited = value;
    } catch {}
    if (inherited) {
      signal.throwIfAborted();
      const reply = await inspectOwner(port, inherited.token);
      signal.throwIfAborted();
      if (reply?.borrowed) return { port, env, waitMs: 0, async release() {} };
    }
    for (;;) {
      signal.throwIfAborted();
      if (announced && Date.now() - started >= waitMs)
        throw new Error(
          'Lantern command lane is occupied; wait deadline exceeded. No work was started.',
        );
      const token = randomUUID(),
        owner: Owner = {
          pid: process.pid,
          command: options.command ?? process.argv.slice(1).join(' '),
          checkout: options.cwd ?? process.cwd(),
          startedAt: Date.now(),
        };
      const sockets = new Set<net.Socket>();
      const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.setTimeout(1000, () => socket.destroy());
        let data = '';
        socket.on('error', () => socket.destroy());
        socket.on('data', (chunk) => {
          data += chunk.toString();
          if (data.length > 8192) {
            socket.destroy();
            return;
          }
          if (!data.includes('\n')) return;
          try {
            const request = JSON.parse(data.split('\n')[0]!);
            socket.end(JSON.stringify({ owner, borrowed: request.token === token }) + '\n');
          } catch {
            socket.destroy();
          }
        });
      });
      const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
        server.once('error', resolve);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve(undefined));
      });
      if (!error) {
        const actual = (server.address() as net.AddressInfo).port;
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
        return {
          port: actual,
          waitMs: Math.round(Date.now() - started),
          env: { ...env, [credentialName]: JSON.stringify({ port: actual, token }) },
          release,
        };
      }
      if (error.code !== 'EADDRINUSE') throw error;
      if (!announced) {
        const reply = await inspectOwner(port);
        signal.throwIfAborted();
        const held = reply?.owner;
        (options.report ?? console.error)(
          held
            ? `Waiting for Lantern command: ${held.command}; PID ${held.pid}; checkout ${held.checkout}; elapsed ${Math.max(0, Math.floor((Date.now() - held.startedAt) / 1000))}s.`
            : 'Waiting for Lantern command lane on port ' + port + '; owner unavailable.',
        );
        announced = true;
      }
      signal.throwIfAborted();
      const remaining = waitMs - (Date.now() - started);
      if (remaining <= 0)
        throw new Error(
          'Lantern command lane is occupied; wait deadline exceeded. No work was started.',
        );
      try {
        await delay(Math.min(250, remaining), undefined, { signal });
      } catch (error) {
        signal.throwIfAborted();
        throw error;
      }
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
