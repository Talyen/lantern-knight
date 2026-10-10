import { desktopEnvironment } from './environment';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { option, type smokeLaunch } from '../smoke/smoke-launch';
import { digest, sourceIdentity } from '../source-identity';
import { requireCurrentDesktopInputs } from '../build-identity';

import { BenchmarkSchema, frameSummary, compareBenchmarks } from './benchmark-model';
export async function captureBenchmark(run: Awaited<ReturnType<typeof smokeLaunch>>) {
  const bounded = (name: string, fallback: string, min: number, max: number) => {
    const value = Number(option(name, fallback, run.flags));
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
  };
  const warmupMs = bounded('--warmup-ms', '2000', 0, 30000),
    requestedMs = bounded('--duration-ms', '10000', 1000, 60000),
    source = await sourceIdentity(process.cwd());
  const loaded = await run.app.evaluate(({ app }) => {
    // Playwright evaluates in a VM without a dynamic-import callback. Node's
    // builtin accessor also retains Electron's ASAR-aware filesystem behavior.
    const fs = process.getBuiltinModule('fs'),
      path = process.getBuiltinModule('path');
    return JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'dist-dev/build-identity.json'), 'utf8'),
    ) as {
      sourceCommit: string | null;
      dirty: boolean;
      inputSha256: string;
      assets: { sha256: string };
      files: Record<string, string>;
    };
  });
  await requireCurrentDesktopInputs(loaded);
  if (
    !loaded.assets?.sha256 ||
    loaded.assets.sha256 !== (process.env.LANTERN_ASSET_SHA256 ?? source.assetSha256)
  )
    throw new Error(
      'Benchmark package asset identity differs; rebuild/package Dev with the selected pack',
    );
  const environment = async () => {
    const desktop = await desktopEnvironment(run);
    const rendering = await run.page.evaluate(() => {
      const p = window.foundation.presentation,
        s = p.stats();
      return {
        viewport: [s.logical[0]!, s.logical[1]!] as [number, number],
        buffer: [s.buffer[0]!, s.buffer[1]!] as [number, number],
        dpr: s.devicePixelRatio,
        gpu: String(s.gpu),
        webgl: String(s.webgl),
        settings: {
          renderScale: s.renderScale,
          verticalSpan: s.verticalSpan,
          animationTreatment: s.animationTreatment,
          stabilized: s.stabilized,
          walkTiming: s.walkTiming,
          rigidSword: s.rigidSword,
          depthOfField: p.depthOfField,
          visualEffects: p.visualEffects,
          lighting: p.lookRenderer.settings,
        },
      };
    });
    return {
      ...desktop,
      ...rendering,
      scenario: 'opening-loop-v1' as const,
      warmupMs,
      assets: loaded.assets.sha256,
    };
  };
  await run.page.evaluate(() => window.foundation.startBenchmark());
  await run.page.waitForTimeout(warmupMs);
  const before = await environment();
  await run.page.evaluate(() => window.foundation.beginBenchmarkMeasurement());
  await run.page.waitForTimeout(requestedMs);
  const result = await run.page.evaluate(() => window.foundation.finishBenchmark(false)),
    after = await environment();
  assert.equal(
    digest(before),
    digest(after),
    'benchmark settings/display changed during measurement',
  );
  assert.deepEqual(await sourceIdentity(process.cwd()), source, 'source changed during benchmark');
  const record = BenchmarkSchema.parse({
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    source,
    build: { sourceCommit: loaded.sourceCommit, dirty: loaded.dirty, sha256: digest(loaded.files) },
    environment: before,
    requestedMs,
    frames: result.frames,
    droppedMs: result.droppedMs,
    simulatedTicks: result.simulatedTicks,
  });
  const output = path.join(run.output, 'benchmark.json');
  await fs.writeFile(output, JSON.stringify(record));
  console.log(
    `Benchmark: ${JSON.stringify(frameSummary(record.frames))}\nComparison input: ${output}`,
  );
  return record;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args.some((a) => a.startsWith('--')))
    throw new Error('Use benchmark:compare -- <baseline.json> <candidate.json>');
  const read = async (file: string) => {
    if ((await fs.stat(file)).size > 16 * 1024 * 1024)
      throw new Error('Benchmark input exceeds 16 MiB');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const first = await read(args[0]!),
    second = await read(args[1]!);
  const compare =
    [2, 3].includes(first.schemaVersion) || [2, 3].includes(second.schemaVersion)
      ? (await import('./game-benchmark')).compareGameBenchmarks
      : compareBenchmarks;
  console.log(JSON.stringify(compare(first, second), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
