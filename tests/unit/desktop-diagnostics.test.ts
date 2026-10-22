import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { DiagnosticLog, readBounded, crashDumps } from '../../electron/diagnostic-log';

test('diagnostics retain bounded events, persist the final admitted record and revoke writes on close', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-diagnostics-');
  const log = new DiagnosticLog(root, { sourceCommit: 'a'.repeat(40) });
  for (let i = 0; i < 200; i++) log.record('event', i + ' ' + '\u0000漢'.repeat(2048));
  const hostile = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [String(i), '\u0000漢'.repeat(1000)]),
  );
  log.setEnvironment(hostile);
  log.fatal(new Error('Synchronous fatal record'));
  assert.match(
    (await readBounded(path.join(root, 'fatal.json'))).toString(),
    /Synchronous fatal record/,
  );
  await log.close();
  const before = await readBounded(path.join(root, 'session.json'));
  const saved = JSON.parse(before.toString());
  assert.equal(saved.events.length, 64);
  assert.equal(saved.events.at(-1).kind, 'environment');
  assert.equal(Object.keys(saved.environment).length, 24);
  log.record('late', 'must not survive disposal');
  assert.deepEqual(await readBounded(path.join(root, 'session.json')), before);
  const next = new DiagnosticLog(root, {});
  next.record('restart', 'second session');
  const report = await next.snapshot();
  assert.deepEqual(report.previous, saved);
  await next.close();
});

test('oversized or corrupt previous diagnostics do not prevent a new session', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-diagnostics-');
  await fs.writeFile(path.join(root, 'session.json'), Buffer.alloc(256 * 1024 + 1));
  const log = new DiagnosticLog(root, {});
  log.record('launch', 'new session');
  assert.equal((await log.snapshot()).previous, undefined);
  await log.close();
  assert.equal(
    JSON.parse((await readBounded(path.join(root, 'session.json'))).toString()).events.length,
    1,
  );
});

test('fatal diagnostics preserve non-Error values thrown by JavaScript', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-diagnostics-');
  const log = new DiagnosticLog(root, {});
  for (const value of ['fatal string', 42, null, undefined]) {
    log.fatal(value);
    const report = JSON.parse((await readBounded(path.join(root, 'fatal.json'))).toString());
    assert.equal(report.detail, String(value));
  }
  await log.close();
});

test('crash export retains two bounded payloads and ignores database files', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-diagnostics-');
  const folder = path.join(root, 'completed');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'database'), 'preserved');
  for (let i = 0; i < 3; i++) {
    const file = path.join(folder, i + '.dmp');
    await fs.writeFile(file, Buffer.alloc(i === 2 ? 8 * 1024 ** 2 + 1 : 4));
    await fs.utimes(file, i + 1, i + 1);
  }
  const dumps = await crashDumps(root);
  assert.deepEqual(
    dumps.map((dump) => dump.name),
    ['2.dmp', '1.dmp'],
  );
  assert.ok('omitted' in dumps[0]!);
  assert.ok('base64' in dumps[1]!);
  assert.equal(Buffer.from(dumps[1].base64, 'base64').length, 4);
  assert.deepEqual((await fs.readdir(folder)).sort(), ['1.dmp', '2.dmp', 'database']);
});
