import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AssetCache } from './assets/cache';
import { inputKey, snapshot, taskDirectory, type InputSnapshot } from './task-state';

export type CommandResult = {
  command: string;
  scope: string;
  outcome: 'passed' | 'failed' | 'not-run';
  unit: 'checks' | 'phases';
  executed: number;
  reused: number;
  failed: number;
  skipped: number;
  durationMs: number;
  selected: string[];
  reasons: string[];
  remaining: string[];
  timings: { name: string; ms: number }[];
  failures?: string[];
  diagnostics?: string;
};
type ReportRecord = {
  schemaVersion: 1;
  recordedAt: string;
  platform: string;
  node: string;
  inputs: string[];
  allInputs: boolean;
  key: string;
  result: CommandResult;
};
export class ReportedFailure extends Error {
  constructor(
    public result: CommandResult,
    public details: string,
  ) {
    super(
      result.command +
        ' failed' +
        (result.failures?.[0] ? ': ' + boundedText(result.failures[0], 1000) : ''),
    );
  }
}
export function boundedText(text: string, bytes: number) {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  // Decode whole code points; a clipped diagnostic must remain valid UTF-8.
  return (
    buffer
      .subarray(0, Math.max(0, bytes - 4))
      .toString('utf8')
      .replace(/\uFFFD$/, '') + '…'
  );
}
export function formatResult(result: CommandResult, details: string) {
  const counts = `${result.executed} executed; ${result.reused} reused; ${result.failed} failed; ${result.skipped} skipped ${result.unit}`;
  const summary = [
    `${result.outcome === 'not-run' ? 'NOT RUN' : result.outcome.toUpperCase()}: ${result.command}; ${boundedText(result.scope.replace(/\s+/g, ' '), 220)}.`,
    `${counts}; ${Math.round(result.durationMs)}ms.${result.reused ? ' Prior passing evidence reused.' : ''}`,
    result.remaining.length
      ? 'Remaining: ' + boundedText(result.remaining.join('; '), 280) + '.'
      : '',
    'Details: ' + details,
  ]
    .filter(Boolean)
    .join('\n');
  const failures = result.failures
    ?.slice(0, 3)
    .map((message) => boundedText(message, 1300))
    .join('\n');
  return summary + (failures ? '\n' + boundedText(failures, 4000) : '');
}
async function atomic(file: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > 256 * 1024) throw new Error('Command details exceed 256 KiB');
  const temporary = file + '.' + randomUUID();
  await fs.writeFile(temporary, text);
  await fs.rename(temporary, file);
}
export async function saveResult(
  root: string,
  result: CommandResult,
  inputs: InputSnapshot,
  names?: string[],
) {
  const selected = names ?? Object.keys(inputs.files);
  const directory = await taskDirectory(root);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'latest-report.json');
  const record: ReportRecord = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    inputs: [...new Set(selected)].sort(),
    allInputs: !names,
    key: inputKey(inputs, selected, 'command-report-v1'),
    result,
  };
  await atomic(file, record);
  // A supervised child communicates its authoritative result without stdout parsing.
  if (process.env.LANTERN_SUPERVISOR_RESULT)
    await atomic(process.env.LANTERN_SUPERVISOR_RESULT, { result, details: file });
  return file;
}
export async function latestResult(root: string, current?: InputSnapshot) {
  const directory = await taskDirectory(root);
  try {
    const file = path.join(directory, 'latest-report.json');
    const record = JSON.parse(await fs.readFile(file, 'utf8')) as ReportRecord;
    if (record.schemaVersion !== 1 || !Array.isArray(record.inputs) || !record.result)
      return undefined;
    const result = record.result;
    if (
      typeof record.allInputs !== 'boolean' ||
      !/^[a-f0-9]{64}$/.test(record.key) ||
      !record.inputs.every((name) => typeof name === 'string') ||
      !['passed', 'failed', 'not-run'].includes(result.outcome) ||
      !['executed', 'reused', 'failed', 'skipped'].every((name) => {
        const value = result[name as 'executed' | 'reused' | 'failed' | 'skipped'];
        return Number.isSafeInteger(value) && value >= 0;
      }) ||
      !Array.isArray(result.selected) ||
      !Array.isArray(result.remaining) ||
      !result.remaining.every((message) => typeof message === 'string') ||
      (result.outcome === 'passed' &&
        (result.failed !== 0 || result.executed + result.reused === 0))
    )
      return undefined;
    const inputs = current ?? (await snapshot(root));
    const matching =
      record.platform === process.platform &&
      record.node === process.version &&
      record.key ===
        inputKey(
          inputs,
          record.allInputs ? Object.keys(inputs.files) : record.inputs,
          'command-report-v1',
        );
    return { ...record, file, matching };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
      return undefined;
    throw error;
  }
}
export async function failureLog(log: string, filename: string) {
  const held = await new AssetCache().lease('diagnostics-' + randomUUID(), 2 * 1024 * 1024);
  try {
    const file = path.join(held.root, filename);
    await fs.writeFile(file, boundedText(log, 1024 * 1024));
    return file;
  } finally {
    await held.release();
  }
}
export async function publishResult(
  root: string,
  result: CommandResult,
  inputs: InputSnapshot,
  names?: string[],
  output?: (chunk: Buffer) => void,
) {
  const details = await saveResult(root, result, inputs, names);
  const text = formatResult(result, details) + '\n';
  if (output) output(Buffer.from(text));
  else process.stdout.write(text);
  if (result.outcome === 'failed') throw new ReportedFailure(result, details);
  return result;
}
