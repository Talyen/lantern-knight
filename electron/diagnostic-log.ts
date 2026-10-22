import fs from 'node:fs/promises';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const MAX_REPORT_BYTES = 256 * 1024;
const MAX_EVENTS = 64;
type DiagnosticEvent = { time: string; kind: string; detail: string };
export type DiagnosticIdentity = {
  sourceCommit?: string;
  inputSha256?: string;
  assetSha256?: string;
};

export async function readBounded(file: string, limit = MAX_REPORT_BYTES) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error('Diagnostic file exceeds limit');
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}

// One host-owned journal, with bounded memory and a coalesced atomic writer.
// No saves, settings, environment variables or renderer-selected file paths enter it.
export class DiagnosticLog {
  private readonly events: DiagnosticEvent[] = [];
  private previous: unknown;
  private environment: Record<string, string> = {};
  private pending = false;
  private writing: Promise<void> | undefined;
  private closed = false;
  private readonly ready: Promise<void>;
  constructor(
    private readonly directory: string,
    private readonly identity: DiagnosticIdentity,
  ) {
    this.ready = this.initialize();
  }
  private async initialize() {
    try {
      this.previous = JSON.parse(
        (await readBounded(path.join(this.directory, 'session.json'))).toString(),
      );
    } catch {
      // A missing, corrupt or oversized previous report never prevents launch.
    }
    await fs.mkdir(this.directory, { recursive: true });
  }
  setEnvironment(environment: Record<string, string>) {
    if (this.closed) return;
    this.environment = Object.fromEntries(
      Object.entries(environment)
        .slice(0, 24)
        .map(([key, value]) => [key.slice(0, 80), value.slice(0, 256).replace(/\p{Cc}/gu, ' ')]),
    );
    this.record('environment', 'System information collected');
  }
  record(kind: string, detail: string) {
    if (this.closed) return;
    this.events.push({
      time: new Date().toISOString(),
      kind: kind.slice(0, 80).replace(/\p{Cc}/gu, ' '),
      detail: detail.slice(0, 1024).replace(/\p{Cc}/gu, ' '),
    });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.pending = true;
    this.writing ??= this.persist().finally(() => {
      this.writing = undefined;
    });
    // Observe failures immediately; flush still reports them to an explicit caller.
    void this.writing.catch(() => {});
  }
  fatal(error: Error) {
    if (this.closed) return;
    // Node exits immediately after an uncaught exception; this small separate
    // file must not depend on the asynchronous journal writer completing.
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(
        path.join(this.directory, 'fatal.json'),
        JSON.stringify({
          time: new Date().toISOString(),
          detail: (error.stack ?? error.message).slice(0, 4096),
        }),
        { mode: 0o600 },
      );
    } catch {
      /* Diagnostic failure must preserve the original fatal exception. */
    }
  }
  private report() {
    return {
      version: 1,
      identity: this.identity,
      environment: this.environment,
      events: [...this.events],
    };
  }
  private async persist() {
    await this.ready;
    while (this.pending) {
      this.pending = false;
      const temporary = path.join(this.directory, 'session.tmp');
      try {
        await fs.writeFile(temporary, JSON.stringify(this.report()), { mode: 0o600 });
        await fs.rename(temporary, path.join(this.directory, 'session.json'));
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
  }
  async snapshot() {
    await this.ready;
    let fatal: unknown;
    try {
      fatal = JSON.parse((await readBounded(path.join(this.directory, 'fatal.json'))).toString());
    } catch {
      /* Optional previous fatal error. */
    }
    return structuredClone({ current: this.report(), previous: this.previous, fatal });
  }
  async close() {
    this.closed = true;
    await this.ready;
    await this.writing;
  }
}

// Crashpad owns its database. Only completed dump payloads are exported, with
// strict count/byte limits; links and unrelated database files are never followed.
export async function crashDumps(directory: string) {
  const files: { file: string; modified: number; bytes: number }[] = [];
  for (const folder of ['completed', 'pending', 'reports']) {
    const root = path.join(directory, folder);
    if (!(await fs.lstat(root).catch(() => undefined))?.isDirectory()) continue;
    for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith('.dmp')) continue;
      const file = path.join(root, entry.name),
        stat = await fs.lstat(file);
      if (stat.isFile()) files.push({ file, modified: stat.mtimeMs, bytes: stat.size });
    }
  }
  files.sort((a, b) => b.modified - a.modified);
  // Keep two recent dumps locally, including an oversized dump for manual diagnosis.
  for (const file of files.slice(2)) await fs.rm(file.file, { force: true });
  return Promise.all(
    files.slice(0, 2).map(async ({ file, bytes }) => ({
      name: path.basename(file),
      bytes,
      ...(bytes <= 8 * 1024 ** 2
        ? { base64: (await readBounded(file, 8 * 1024 ** 2)).toString('base64') }
        : { omitted: 'Dump exceeds 8 MiB export limit' }),
    })),
  );
}
