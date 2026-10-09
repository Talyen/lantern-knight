import { z } from 'zod';
import { digest } from '../source-identity';
const pair = z.tuple([z.number().positive(), z.number().positive()]);
export const BenchmarkSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordedAt: z.string(),
    source: z.object({
      commit: z.string(),
      dirty: z.boolean(),
      sha256: z.string(),
      assetSha256: z.string(),
    }),
    build: z.object({
      sourceCommit: z.string().nullable(),
      dirty: z.boolean(),
      sha256: z.string(),
    }),
    environment: z
      .object({
        hardware: z.string().min(1),
        os: z.string(),
        arch: z.string(),
        runtime: z.record(z.string(), z.string()),
        flags: z.array(z.string()),
        gpu: z.string(),
        webgl: z.string(),
        refreshHz: z.number().nonnegative(),
        visible: z.boolean(),
        viewport: pair,
        buffer: pair,
        dpr: z.number().positive(),
        scenario: z.literal('opening-loop-v1'),
        warmupMs: z.number().nonnegative(),
        assets: z.string().regex(/^[a-f0-9]{64}$/),
        settings: z.record(z.string(), z.unknown()),
      })
      .strict(),
    requestedMs: z.number().positive(),
    frames: z.array(z.number().finite().positive()).min(30).max(100000),
    droppedMs: z.number().nonnegative(),
    simulatedTicks: z.number().int().nonnegative(),
  })
  .strict();
export type BenchmarkRecord = z.infer<typeof BenchmarkSchema>;
export function frameSummary(frames: number[]) {
  if (frames.length < 30 || frames.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error('Benchmark requires at least 30 finite positive frame gaps');
  const sorted = [...frames].sort((a, b) => a - b),
    durationMs = frames.reduce((a, b) => a + b, 0);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
  return {
    frames: frames.length,
    durationMs,
    fps: (frames.length * 1000) / durationMs,
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    hitchesPer30s: (frames.filter((n) => n >= 50).length * 30000) / durationMs,
    stallsPer30s: (frames.filter((n) => n >= 100).length * 30000) / durationMs,
  };
}
export function compareBenchmarks(first: unknown, second: unknown) {
  const baseline = BenchmarkSchema.parse(first),
    candidate = BenchmarkSchema.parse(second);
  if (
    !baseline.environment.refreshHz ||
    !candidate.environment.refreshHz ||
    [baseline, candidate].some((r) => r.environment.gpu === 'unavailable')
  )
    throw new Error('Comparison requires available refresh-rate and GPU observations');
  const differing = (
    Object.keys(baseline.environment) as (keyof BenchmarkRecord['environment'])[]
  ).filter((key) => digest(baseline.environment[key]) !== digest(candidate.environment[key]));
  if (differing.length)
    throw new Error('Incompatible benchmark conditions: ' + differing.join(', '));
  const before = frameSummary(baseline.frames),
    after = frameSummary(candidate.frames);
  return {
    before,
    after,
    delta: {
      p95Ms: after.p95Ms - before.p95Ms,
      p99Ms: after.p99Ms - before.p99Ms,
      hitchesPer30s: after.hitchesPer30s - before.hitchesPer30s,
      stallsPer30s: after.stallsPer30s - before.stallsPer30s,
    },
    limitations: [
      'Frame callback cadence is not GPU present timing or proof of visual parity.',
      'Repeat matching observations; one comparison does not establish a performance improvement.',
    ],
  };
}
