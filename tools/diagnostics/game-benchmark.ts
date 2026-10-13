import { desktopEnvironment } from './environment';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { BenchmarkSchema, frameSummary } from './benchmark-model';
import { digest } from '../source-identity';
import { verificationIdentity, requireStableInputs } from '../verification';
import { requireCurrentDesktopInputs } from '../build-identity';
import type { smokeLaunch } from '../smoke/smoke-launch';

export const journeyPhases = ['movement', 'actions', 'checkpoint'] as const;
const segment = z.strictObject({
  name: z.enum(journeyPhases),
  frames: z.array(z.number().finite().positive()).min(30).max(100000),
  actions: z.array(z.string()).max(20000),
});
export const GameBenchmarkSchema = BenchmarkSchema.omit({
  requestedMs: true,
  simulatedTicks: true,
  droppedMs: true,
  source: true,
})
  .extend({
    schemaVersion: z.union([z.literal(3), z.literal(4)]),
    source: z.object({ commit: z.string().nullable(), dirty: z.boolean(), sha256: z.string() }),
    environment: z.union([
      BenchmarkSchema.shape.environment.extend({
        scenario: z.literal('game-empty-v1'),
        warmupMs: z.literal(0),
      }),
      BenchmarkSchema.shape.environment.extend({
        scenario: z.literal('game-walking-v1'),
        warmupMs: z.literal(1000),
      }),
    ]),
    initialCheckpoint: z.string().regex(/^[a-f0-9]{64}$/),
    startup: z.object({
      launchToReadyMs: z.number().positive(),
      rendererReadyObservationMs: z.number().positive(),
    }),
    segments: z.array(segment).min(1).max(journeyPhases.length),
  })
  .strict()
  .refine((record) => {
    const walking = record.environment.scenario === 'game-walking-v1';
    return (
      record.schemaVersion === (walking ? 4 : 3) &&
      record.segments.length === (walking ? 1 : journeyPhases.length) &&
      record.segments.every((s, i) => s.name === journeyPhases[i])
    );
  }, 'Every production journey phase must complete in order')
  .refine(
    (record) =>
      record.schemaVersion !== 4 ||
      (record.frames.reduce((sum, ms) => sum + ms, 0) >= 4900 &&
        digest(record.segments[0]?.actions) === digest(['keydown:KeyW:false'])),
    'Walking baseline requires five seconds with the fixed forward input',
  )
  .refine(
    (record) => digest(record.frames) === digest(record.segments.flatMap((s) => s.frames)),
    'Whole-journey samples must match the completed phases',
  );
export function compareGameBenchmarks(first: unknown, second: unknown) {
  const before = GameBenchmarkSchema.parse(first),
    after = GameBenchmarkSchema.parse(second);
  if (
    !before.environment.refreshHz ||
    !after.environment.refreshHz ||
    [before, after].some((r) => r.environment.gpu === 'unavailable')
  )
    throw new Error('Comparison requires available refresh-rate and GPU observations');
  assert.equal(
    digest(before.environment),
    digest(after.environment),
    'Incompatible benchmark conditions',
  );
  assert.equal(
    before.initialCheckpoint,
    after.initialCheckpoint,
    'Incompatible initial checkpoint',
  );
  assert.equal(
    digest(before.segments.map((s) => s.actions)),
    digest(after.segments.map((s) => s.actions)),
    'Incompatible adaptive journey actions; capture matching runs before comparing',
  );
  return {
    before: frameSummary(before.frames),
    after: frameSummary(after.frames),
    startupDeltaMs: after.startup.launchToReadyMs - before.startup.launchToReadyMs,
    segments: before.segments.map((s, i) => ({
      name: s.name,
      before: frameSummary(s.frames),
      after: frameSummary(after.segments[i]!.frames),
    })),
    limitations: [
      'Frame callbacks are not GPU present timing or visual parity.',
      'Adaptive player journeys compare only with matching recorded inputs.',
      'Startup values are harness observations from fresh processes, not an OS-cold disk-cache measurement.',
    ],
  };
}

// Instrumentation is injected by the harness; the player has no inspection API.
type Samples = {
  frames: number[];
  actions: string[];
  last: number;
  request: number;
  overflow: boolean;
  foreground: boolean;
  stop: () => void;
};
type SampleWindow = Window & { __lanternMeasurement?: Samples };
export async function startGameBenchmark(
  run: Awaited<ReturnType<typeof smokeLaunch>>,
  initialCheckpoint: unknown,
  walking = false,
) {
  // tsx preserves names in functions serialized into the renderer by Playwright.
  await run.page.evaluate(() => Reflect.set(window, '__name', (fn: Function) => fn));
  const source = await verificationIdentity(process.cwd());
  const loaded = await run.app.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('fs'),
      path = process.getBuiltinModule('path');
    return JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'dist/build-identity.json'), 'utf8'),
    ) as {
      sourceCommit: string | null;
      dirty: boolean;
      inputSha256: string;
      assets: { sha256: string };
      files: Record<string, string>;
    };
  });
  await requireCurrentDesktopInputs(loaded);
  assert.equal(
    loaded.assets.sha256,
    process.env.LANTERN_ASSET_SHA256,
    'Game benchmark package asset pin differs',
  );
  const environment = async () => {
    const desktop = await desktopEnvironment(run);
    const rendering = await run.page.evaluate(() => {
      const canvas = document.querySelector('canvas')!,
        rect = canvas.getBoundingClientRect(),
        gl = canvas.getContext('webgl2')!,
        info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        viewport: [rect.width, rect.height],
        buffer: [canvas.width, canvas.height],
        dpr: devicePixelRatio,
        gpu: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
        webgl: String(gl.getParameter(gl.VERSION)),
        settings: Object.fromEntries(
          [
            ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
              '#modal input,#modal select',
            ),
          ].map((el) => [
            el.id || el.dataset.visualEffect!,
            el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value,
          ]),
        ),
      };
    });
    return {
      ...desktop,
      ...rendering,
      ...(walking
        ? { scenario: 'game-walking-v1' as const, warmupMs: 1000 as const }
        : { scenario: 'game-empty-v1' as const, warmupMs: 0 as const }),
      assets: loaded.assets.sha256,
    };
  };
  const before = await environment(),
    segments: z.infer<typeof segment>[] = [],
    startup = { launchToReadyMs: run.readyMs, rendererReadyObservationMs: run.rendererReadyMs };
  let active: (typeof journeyPhases)[number] | undefined,
    record: z.infer<typeof GameBenchmarkSchema> | undefined;
  const end = async () => {
    if (!active) return;
    await run.page.waitForFunction(
      () =>
        ((globalThis as unknown as SampleWindow).__lanternMeasurement?.frames.length ?? 0) >= 30,
      {},
      { timeout: 15000 },
    );
    const samples = await run.page.evaluate(() => {
      const window = globalThis as unknown as SampleWindow,
        m = window.__lanternMeasurement!;
      m.stop();
      delete window.__lanternMeasurement;
      return {
        frames: m.frames,
        actions: m.actions,
        overflow: m.overflow,
        foreground: m.foreground,
      };
    });
    assert.equal(samples.overflow, false, 'Game benchmark sample budget exceeded');
    if (walking) assert.equal(samples.foreground, true, 'Walking baseline lost foreground focus');
    segments.push(
      segment.parse({ name: active, frames: samples.frames, actions: samples.actions }),
    );
    active = undefined;
  };
  return {
    async phase(name: (typeof journeyPhases)[number]) {
      await end();
      assert.equal(name, journeyPhases[segments.length], 'Game benchmark phase order differs');
      active = name;
      await run.page.evaluate(() => {
        const window = globalThis as unknown as SampleWindow,
          m: Samples = {
            frames: [],
            actions: [],
            last: 0,
            request: 0,
            overflow: false,
            foreground: true,
            stop: () => {},
          };
        const frame = (now: number) => {
          m.foreground &&= document.hasFocus() && document.visibilityState === 'visible';
          if (m.last) {
            if (m.frames.length < 100000) m.frames.push(now - m.last);
            else m.overflow = true;
          }
          m.last = now;
          m.request = requestAnimationFrame(frame);
        };
        const key = (event: KeyboardEvent) => {
          if (m.actions.length >= 20000) {
            m.overflow = true;
            return;
          }
          m.actions.push(`${event.type}:${event.code}:${event.repeat}`);
        };
        const pointer = (event: PointerEvent) => {
          if (m.actions.length >= 20000) {
            m.overflow = true;
            return;
          }
          const target = event.target as HTMLElement;
          m.actions.push(
            `${event.type}:${target.id || target.tagName}:${event.button}:${Math.round(event.clientX)},${Math.round(event.clientY)}`,
          );
        };
        document.addEventListener('keydown', key, true);
        document.addEventListener('keyup', key, true);
        document.addEventListener('pointerdown', pointer, true);
        m.stop = () => {
          cancelAnimationFrame(m.request);
          document.removeEventListener('keydown', key, true);
          document.removeEventListener('keyup', key, true);
          document.removeEventListener('pointerdown', pointer, true);
        };
        window.__lanternMeasurement = m;
        m.request = requestAnimationFrame(frame);
        return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    },
    stop: end,
    async finish() {
      await end();
      assert.equal(
        digest(before),
        digest(await environment()),
        'Game benchmark environment changed',
      );
      await requireStableInputs(process.cwd(), source);
      record = GameBenchmarkSchema.parse({
        schemaVersion: walking ? 4 : 3,
        recordedAt: new Date().toISOString(),
        source,
        build: {
          sourceCommit: loaded.sourceCommit,
          dirty: loaded.dirty,
          sha256: digest(loaded.files),
        },
        environment: before,
        initialCheckpoint: digest(initialCheckpoint),
        startup,
        segments,
        frames: segments.flatMap((s) => s.frames),
      });
      return record;
    },
    async publish() {
      assert.ok(record, 'Game benchmark did not finish');
      await requireStableInputs(process.cwd(), source);
      const file = path.join(run.output, 'benchmark.json');
      await fs.writeFile(file, JSON.stringify(record));
      console.log(
        `Game benchmark: ${JSON.stringify(frameSummary(record.frames))}\n${record.segments.map((s) => `${s.name}: ${JSON.stringify(frameSummary(s.frames))}`).join('\n')}\nFresh-process startup observation: ${startup.launchToReadyMs.toFixed(0)} ms\nComparison input: ${file}`,
      );
    },
  };
}
