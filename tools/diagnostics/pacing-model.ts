import { z } from 'zod';
import assert from 'node:assert/strict';
import { BenchmarkSchema, frameSummary } from './benchmark-model';
import { digest } from '../source-identity';

export const PacingSchema = BenchmarkSchema.omit({
  source: true,
  requestedMs: true,
  droppedMs: true,
  simulatedTicks: true,
})
  .extend({
    schemaVersion: z.literal(6),
    build: BenchmarkSchema.shape.build.extend({ inputSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
    harness: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
    environment: BenchmarkSchema.shape.environment
      .omit({ scenario: true })
      .extend({ scenario: z.string().min(1) }),
    fixture: z.string(),
    durationMs: z.number().positive(),
    foreground: z.literal(true),
    actions: z.array(z.string()).min(1),
    proof: z.object({
      moved: z.boolean(),
      ability: z.boolean(),
      dodge: z.boolean(),
      combat: z.boolean(),
    }),
  })
  .refine(
    (record) => record.frames.reduce((sum, ms) => sum + ms, 0) >= record.durationMs - 1,
    'Pacing active sample is shorter than the requested duration',
  );
export function pacingAcceptance(frames: number[], refreshHz: number) {
  const summary = frameSummary(frames),
    // Subtracting browser timestamps leaves binary residue well below a ns.
    // Normalize only that residue; retain every raw observation in the record.
    ns = (ms: number) => Math.round(ms * 1e6) / 1e6,
    lateIntervals = frames.filter((ms) => ns(ms) >= 25).length;
  return {
    ...summary,
    lateIntervals,
    estimatedMissedRefreshes: frames.reduce(
      (sum, ms) => sum + Math.max(0, Math.round((ns(ms) * refreshHz) / 1000) - 1),
      0,
    ),
    target:
      refreshHz < 59 || refreshHz > 61
        ? 'inconclusive'
        : summary.fps >= 59 &&
            ns(summary.p95Ms) <= 18 &&
            ns(summary.p99Ms) <= 20 &&
            lateIntervals === 0
          ? 'met'
          : 'missed',
  };
}
export function comparePacing(first: unknown, second: unknown) {
  const before = PacingSchema.parse(first),
    after = PacingSchema.parse(second);
  assert.ok(
    [before, after].every(
      (r) =>
        r.environment.visible &&
        r.environment.refreshHz > 0 &&
        !/software|swiftshader|unavailable|llvmpipe/i.test(r.environment.gpu),
    ),
    'Pacing comparison requires visible hardware rendering and an observed refresh rate',
  );
  assert.equal(before.harness.sha256, after.harness.sha256, 'Incompatible pacing harness');
  assert.equal(
    digest(before.environment),
    digest(after.environment),
    'Incompatible pacing environment',
  );
  assert.equal(before.fixture, after.fixture, 'Incompatible pacing fixture');
  assert.equal(before.durationMs, after.durationMs, 'Incompatible pacing duration');
  assert.equal(digest(before.actions), digest(after.actions), 'Incompatible pacing inputs');
  assert.ok(
    Object.values(before.proof).every(Boolean) && Object.values(after.proof).every(Boolean),
    'Pacing journey did not complete its gameplay work',
  );
  return {
    before: pacingAcceptance(before.frames, before.environment.refreshHz),
    after: pacingAcceptance(after.frames, after.environment.refreshHz),
  };
}
